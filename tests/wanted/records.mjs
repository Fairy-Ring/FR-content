// Production ScriptRunner + Player modal/queue/timer + InstanceController tests.
// Run from sibling engine: node --import tsx ../content/tests/wanted/records.mjs
// Scenery/client rendering is the separate live cell, not claimed by this suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(engine, rel)).href)).default;
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts');
const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
const ScriptState = await load('src/engine/script/ScriptState.ts');
const { PlayerTimerType } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityTimer.ts')).href);
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'MesanimType']) {
    const type = await load(`src/cache/config/${name}.ts`);
    type.load(pack);
}
assert(ScriptProvider.load(pack) > 0);
World.currentTick = 100;
const maps = new Map();
function id(kind, name) {
    if (!maps.has(kind)) maps.set(kind, new Map(fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8').split('\n').filter(x => /^\d+=/.test(x)).map(x => { const at = x.indexOf('='); return [x.slice(at + 1).trim(), Number(x.slice(0, at))]; })));
    const value = maps.get(kind).get(name);
    assert.notEqual(value, undefined, `${kind}:${name}`);
    return value;
}
const get = (p, name) => p.getVar(id('varp', name));
const stage = p => p.getVarBit(id('varbit', 'wanted_main'));
const tile = p => [p.level, p.x, p.z];
const home = [0, 2998, 3373];
const inventory = p => p.getInventory(id('inv', 'inv'));
const orbCount = p => inventory(p).getItemCount(id('obj', 'wanted_crystal_ball'));
const actors = p => [...World.npcs].filter(n => n.isActive && (n.getVar(id('varn', 'npc_attacking_uid')) >>> 0) === p.uid);
function player(slot = 1) {
    const p = new Player(`wanted_record_${slot}`, 0n, 0n);
    p.slot = slot;
    p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | slot) >>> 0;
    p.isActive = true;
    p.level = home[0]; p.x = home[1]; p.z = home[2];
    p.lastMovement = World.currentTick - 20;
    p.levels.fill(10);
    p.baseLevels.fill(10);
    p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.packets.push({ text });
    p.wrappedMessageGame = p.messageGame;
    p.setVarBit(id('varbit', 'wanted_main'), 8);
    p.setVarBit(id('varbit', 'wanted_commorb_intel'), 1);
    p.setVarBit(id('varbit', 'wanted_contacted_savant'), 1);
    // Deliberate unit fixture: exercise preservation of every packed base572 bit.
    p.setVar(id('varp', 'quest_wanted2'), -1);
    p.wantedBefore = [get(p, 'quest_wanted'), get(p, 'quest_wanted2')];
    inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    World.players[slot] = p;
    World.gameMap.getZone(p.x, p.z, p.level).enter(p);
    return p;
}
function invoke(p, name, args = [], protect = true) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing ${name}`);
    const state = ScriptRunner.init(script, p, null, args);
    p.executeScript(state, protect, true);
    assert.notEqual(state.execution, ScriptState.ABORTED, name);
    return state;
}
function resume(p, state) {
    assert([ScriptState.PAUSEBUTTON, ScriptState.SUSPENDED].includes(state.execution), `unexpected boundary ${state.execution}`);
    if (state.execution === ScriptState.SUSPENDED) {
        assert(p.delayedUntil > World.currentTick, 'effect uses an actual timed delay');
        World.currentTick = p.delayedUntil;
        p.delayed = false;
    }
    p.executeScript(state, true, true);
    assert.notEqual(state.execution, ScriptState.ABORTED, state.script.name);
}
function finish(p, state) {
    let boundaries = 0;
    while ([ScriptState.PAUSEBUTTON, ScriptState.SUSPENDED].includes(state.execution)) {
        assert(boundaries++ < 100, 'finite record');
        resume(p, state);
    }
    assert.equal(state.execution, ScriptState.FINISHED);
    return boundaries;
}
function assertReturned(p, label, destination = home, expectedOrbs = 1) {
    assert.equal(get(p, 'wanted_record_active'), 0, `${label}: active cleared`);
    assert.deepEqual(tile(p), destination, `${label}: expected exit tile`);
    assert.equal(actors(p).length, 0, `${label}: owned actors removed`);
    assert.equal(stage(p), 8, `${label}: no progression write`);
    assert.equal(orbCount(p), expectedOrbs, `${label}: expected held orb count`);
    for (const name of ['wanted_contacted_savant', 'wanted_commorb_intel']) assert.equal(p.getVarBit(id('varbit', name)), 1, `${label}: preserve ${name}`);
    assert.deepEqual([get(p, 'quest_wanted'), get(p, 'quest_wanted2')], p.wantedBefore, `${label}: preserve both permanent packed bases`);
    assert.equal([...p.queue.all()].length, 0, `${label}: logout queue cleared`);
    assert.equal([...p.weakQueue.all()].length, 0, `${label}: operation marker cleared`);
    assert(![...p.timers.values()].some(x => x.script.name === '[softtimer,wanted_record_watch]'), `${label}: timer cleared`);
    assert(p.packets.some(x => x.constructor.name === 'CamReset'), `${label}: camera reset to defaults`);
    assert(p.packets.some(x => x.constructor.name === 'MinimapToggle' && x.minimapType === 0), `${label}: minimap reset to defaults`);
    assert(p.packets.some(x => x.constructor.name === 'IfSetTab' && x.tab === 6 && x.component !== -1), `${label}: default magic tab restored`);
}
function interrupt(p) {
    p.closeModal();
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    p.delayed = false;
    p.protect = false;
    p.processTimers(PlayerTimerType.SOFT);
}
for (const [name, expectedActors] of [['daquarius', 4], ['zamorak', 2]]) {
    const p = player();
    let state = invoke(p, `[label,wanted_record_${name}]`);
    assert.equal(state.execution, ScriptState.PAUSEBUTTON);
    assert.equal(actors(p).length, expectedActors);
    assert.notDeepEqual(tile(p), home);
    const boundaries = finish(p, state);
    assertReturned(p, `${name} complete`);
    state = invoke(p, `[label,wanted_record_${name}]`);
    assert.equal(finish(p, state), boundaries, 'repeat has the same complete sequence');
    assertReturned(p, `${name} repeated`);
    for (let stop = 0; stop < boundaries; stop++) {
        state = invoke(p, `[label,wanted_record_${name}]`);
        for (let at = 0; at < stop; at++) resume(p, state);
        const generation = get(p, 'wanted_record_generation');
        const delayed = state.execution === ScriptState.SUSPENDED;
        interrupt(p);
        assertReturned(p, `${name} interrupt ${stop}`);
        // A delayed interpreter may still resume after cleanup. Its generation
        // must not teleport, remove actors, or close a newer playback.
        const next = invoke(p, `[label,wanted_record_${name}]`);
        const nextTile = tile(p);
        const nextGeneration = get(p, 'wanted_record_generation');
        assert.notEqual(nextGeneration, generation);
        if (delayed) {
            p.executeScript(state, true, true);
            assert.equal(state.execution, ScriptState.FINISHED, 'stale delay exits');
            assert.deepEqual(tile(p), nextTile, 'stale delay cannot return the newer scene');
            assert.equal(get(p, 'wanted_record_generation'), nextGeneration);
            assert.equal(actors(p).length, expectedActors, 'stale delay cannot remove new actors');
        }
        invoke(p, '[softtimer,wanted_record_watch]', [generation], false);
        assert.equal(get(p, 'wanted_record_active'), name === 'daquarius' ? 1 : 2, 'stale timer cannot clean a new generation');
        finish(p, next);
        assertReturned(p, `${name} after stale ${stop}`);
    }
    console.log(`PASS ${name}: complete/repeat, all ${boundaries} dialogue/effect interruption boundaries, stale delay/timer protection`);
}
{
    const p = player();
    invoke(p, '[label,wanted_record_daquarius]');
    p.closeModal();
    p.loggingOut = true;
    p.protect = false;
    p.processQueue();
    assertReturned(p, 'accelerated real logout queue');
    assert.equal(p.activeScript, null, 'logout detaches the paused scene');
    p.loggingOut = false;
}
{
    const p = player();
    invoke(p, '[label,wanted_record_zamorak]');
    const destination = [0, 2993, 3375];
    World.gameMap.getZone(destination[1], destination[2], destination[0]);
    p.teleJump(destination[1], destination[2], destination[0]);
    assert.deepEqual(tile(p), destination, 'external teleport actually leaves the instance');
    World.currentTick++;
    p.processTimers(PlayerTimerType.SOFT);
    assertReturned(p, 'external scene exit', destination);
    assert.equal(p.activeScript, null, 'external exit detaches the paused scene');
}
for (const name of ['daquarius', 'zamorak']) {
    const p = player();
    const state = invoke(p, `[label,wanted_record_${name}]`);
    while (state.execution === ScriptState.PAUSEBUTTON) resume(p, state);
    assert.equal(state.execution, ScriptState.SUSPENDED);
    p.closeModal();
    p.loggingOut = true;
    World.currentTick = p.delayedUntil;
    p.delayed = false; p.protect = false;
    p.processQueue();
    assertReturned(p, `${name} logout during effect`);
    p.executeScript(state, true, true);
    assert.equal(state.execution, ScriptState.FINISHED, 'post-logout delayed continuation exits');
    assertReturned(p, `${name} post-logout continuation`);
    p.loggingOut = false;
}
{
    const p = player();
    const other = player(2);
    invoke(p, '[label,wanted_record_daquarius]');
    const second = invoke(other, '[label,wanted_record_zamorak]');
    assert.notEqual(get(p, 'wanted_record_uid'), get(other, 'wanted_record_uid'), 'different private instances');
    interrupt(p);
    assertReturned(p, 'first player interruption');
    assert.equal(actors(other).length, 2, 'other player actors are not removed');
    assert.equal(get(other, 'wanted_record_active'), 2);
    finish(other, second);
    assertReturned(other, 'second player completion');
    assert.equal(p.activeScript, null, 'interruption detaches only the first player scene');
}
{
    const p = player();
    inventory(p).remove(id('obj', 'wanted_crystal_ball'), 1);
    const state = invoke(p, '[label,wanted_playback]');
    assert.equal(state.execution, ScriptState.FINISHED, 'missing orb cannot enter playback');
    assert.equal(get(p, 'wanted_record_active'), 0);
    assert.deepEqual(tile(p), home);
    inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    const menu = invoke(p, '[label,wanted_playback]');
    assert.equal(menu.execution, ScriptState.PAUSEBUTTON);
    p.lastCom = id('interface', 'multi4:com_4');
    resume(p, menu);
    assert.equal(menu.execution, ScriptState.FINISHED, 'cancel cannot create an instance');
    assert.equal(get(p, 'wanted_record_active'), 0);
    assert.equal(stage(p), 8);
}
// Entry uses the real shared teleport checks, then rechecks after the selector.
for (const [label, position, setup, expected] of [
    ['deep wilderness', [0, 3100, 3700], () => {}, /level 20 wilderness/],
    ['duel', [0, 3340, 3250], () => {}, /can't teleport from a duel/],
    ['Castle Wars', [0, 2400, 3100], () => {}, /can't leave just like that/],
    ['recent combat', home, p => p.setVar(id('varp', 'lastcombat'), World.currentTick), /cannot use this whilst in combat/],
    ['recent PvP', home, p => p.setVar(id('varp', 'lastcombat_pvp'), World.currentTick), /cannot use this whilst in combat/],
]) {
    const p = player();
    p.level = position[0]; p.x = position[1]; p.z = position[2];
    setup(p);
    const menu = invoke(p, '[label,wanted_playback]');
    p.lastCom = id('interface', 'multi4:com_1');
    resume(p, menu);
    while (menu.execution === ScriptState.PAUSEBUTTON) resume(p, menu);
    assert.equal(menu.execution, ScriptState.FINISHED, label);
    assert.equal(get(p, 'wanted_record_active'), 0, `${label}: no scene`);
    assert.deepEqual(tile(p), position, `${label}: no movement`);
    assert.equal(actors(p).length, 0, `${label}: no actors`);
    assert.match(p.packets.map(x => x.text ?? '').join(' '), expected, label);
}
{
    const p = player();
    const menu = invoke(p, '[label,wanted_playback]');
    p.setVar(id('varp', 'lastcombat'), World.currentTick);
    p.lastCom = id('interface', 'multi4:com_2');
    resume(p, menu);
    assert.equal(menu.execution, ScriptState.FINISHED, 'combat acquired during selector blocks entry');
    assert.equal(get(p, 'wanted_record_active'), 0);
    assert.deepEqual(tile(p), home);
}
for (const name of ['playerhit_n_retaliate', 'combat_damage_player', 'pvp_damage', 'damage_player', 'recoil_damage', 'poison_damage', 'player_death_default']) {
    const p = player();
    const menu = invoke(p, '[label,wanted_playback]');
    p.enqueueScript(ScriptProvider.getByName(`[queue,${name}]`));
    p.lastCom = id('interface', 'multi4:com_1');
    resume(p, menu);
    assert.equal(menu.execution, ScriptState.FINISHED, `${name}: pending damage refuses entry`);
    assert.equal(get(p, 'wanted_record_active'), 0, `${name}: no private scene`);
    assert.deepEqual(tile(p), home);
    assert(p.packets.some(x => x.text === 'You cannot use this whilst in combat.'), `${name}: standard refusal`);
}
// The ordinary death queue must leave the disposable region before its first
// delay and before keep/drop allocation. Death is not a free safe-death escape.
for (const external of [false, true]) {
    const p = player();
    invoke(p, '[label,wanted_record_zamorak]');
    const destination = external ? [0, 2993, 3375] : home;
    if (external) {
        World.gameMap.getZone(destination[1], destination[2], destination[0]);
        p.teleJump(destination[1], destination[2], destination[0]);
    }
    p.closeModal();
    const death = invoke(p, '[queue,player_death_default]');
    assert.equal(death.execution, ScriptState.SUSPENDED, 'real death queue reaches its first delay');
    assertReturned(p, external ? 'death after external exit' : 'death before ordinary loss', destination);
    // Execute ordinary keep/drop allocation on the mainland. Skull forces the
    // Commorb into an actual ground object rather than the three kept items.
    p.setVar(id('varp', 'pk_skull'), 1);
    p.delayed = false;
    invoke(p, '[proc,player_death_lose_items]');
    assert.equal(orbCount(p), 0, 'ordinary death still loses the unprotected orb');
    const zone = World.gameMap.getZone(destination[1], destination[2], destination[0]);
    assert(zone.getObj(destination[1], destination[2], id('obj', 'wanted_crystal_ball'), p.username37), 'death orb remains recoverable outside the deleted instance');
}
console.log('PASS teleport wilderness/duel/Castle Wars/combat admission, selector race, external destination and ordinary death drops');
console.log('PASS playback admission/cancel, exact return, camera/minimap/tabs, real logout queue, isolated two-player actors');
console.log('RESULT PASS Wanted S3 compiled observation records');
process.exit(0);
