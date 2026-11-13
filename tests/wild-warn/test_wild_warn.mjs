// Run from the sibling engine: node --import tsx ../content/tests/wild-warn/test_wild_warn.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(engine, rel)).href)).default;
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts');
const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
const ScriptState = await load('src/engine/script/ScriptState.ts');
const CloseModalHandler = await load('src/network/game/client/handler/CloseModalHandler.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'InvType', 'ObjType', 'SeqType', 'FontType', 'Component']) {
    types[name] = await load(`src/cache/config/${name}.ts`);
    types[name].load(pack);
}
assert(ScriptProvider.load(pack) > 0, 'production scripts are packed');
World.currentTick = 1;
const ids = {};
function id(kind, name) {
    ids[kind] ??= new Map(fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8').split('\n').filter(x => /^\d+=/.test(x)).map(x => {
        const at = x.indexOf('=');
        return [x.slice(at + 1).trim(), Number(x.slice(0, at))];
    }));
    const value = ids[kind].get(name);
    assert.notEqual(value, undefined, `${kind}:${name}`);
    return value;
}
const warning = id('interface', 'wilderness_warning');
const wilderness = id('varp', 'wilderness');
function player(z = 3509, x = 3100, state = 0) {
    const p = new Player('wild_warn_test', 0n, 0n);
    Object.assign(p, { uid: 1, pid: 1, level: 0, x, z, lastMovement: 0, packets: [] });
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.packets.push({ text });
    p.setVar(wilderness, state);
    return p;
}
function run(p, name) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing packed ${name}`);
    const execution = p.runScript(ScriptRunner.init(script, p), true, true);
    assert.equal(execution, ScriptState.FINISHED, name);
}
function coordinate(x, z) {
    return `0_${x >> 6}_${z >> 6}_${x & 63}_${z & 63}`;
}
// Independent donor inventory: 58 consecutive surface zones, one dungeon zone.
const donorZones = Array.from({ length: 58 }, (_, i) => [2928 + i * 8, 3512]);
donorZones.push([3128, 9912]);
for (const [x, z] of donorZones) {
    const name = `[zone,${coordinate(x, z)}]`;
    const p = player(z, x);
    run(p, name);
    const requests = [...p.queue.all()];
    assert.equal(requests.length, 1, `${name} enqueues once`);
    assert.equal(requests[0].script.name, '[queue,wilderness_warning]');
    assert.equal(requests[0].delay, 0, `${name} delay`);
    p.processQueues();
    assert.equal(p.modalMain, warning, `${name} executes real queued warning`);
    assert.equal(p.getVar(wilderness), 1, `${name} marks this login warned`);
}
console.log('PASS 59 donor zones: packed triggers enqueue and execute the production warning');

for (const boundary of [3512, 9912]) {
    for (const offset of [-8, -1, 0, 1, 2, 3, 4, 7, 8, 30]) {
        for (const state of [0, 1]) {
            const p = player(boundary + offset, 3100, state);
            p.queueWaypoint(p.x, p.z + 10);
            assert(p.hasWaypoints());
            run(p, '[queue,wilderness_warning]');
            const opens = state === 0 && offset >= 0 && offset < 4;
            assert.equal(p.modalMain, opens ? warning : -1, `boundary ${boundary}, offset ${offset}, state ${state}`);
            assert.equal(p.hasWaypoints(), !opens, 'only a displayed warning stops the existing walk');
            assert.equal(p.getVar(wilderness), 1, 'first zone entry sets the flag even outside the four-tile band');
            assert.equal(p.delayed, false, 'warning adds no player delay');
        }
    }
}
console.log('PASS both four-tile bands, both flag states, outside-band suppression and walk preservation');

{
    const p = player(3512);
    run(p, '[queue,wilderness_warning]');
    const tile = [p.x, p.z, p.level];
    const close = new CloseModalHandler();
    assert.equal(close.handle({}, p), true);
    assert.equal(p.requestModalClose, true, 'native close packet schedules closure');
    p.processQueues();
    assert.equal(p.modalMain, -1);
    assert.equal(p.canAccess(), true, 'closing restores ordinary actions');
    assert.deepEqual([p.x, p.z, p.level], tile, 'Close Window does not move the player');
    run(p, '[proc,wilderness_exit]');
    assert.equal(p.getVar(wilderness), 1, 'leaving Wilderness does not rearm the warning');
    p.z = 3512;
    run(p, '[queue,wilderness_warning]');
    assert.equal(p.modalMain, -1, 'second same-session crossing does not warn');
    const relogged = player(3512);
    run(relogged, '[queue,wilderness_warning]');
    assert.equal(relogged.modalMain, warning, 'new login temporary state rearms the warning');
}
{
    const p = player(3520);
    run(p, '[proc,wilderness_enter]');
    assert.equal(p.getVar(wilderness), 1, 'level-line entry marks Wilderness before later band re-entry');
    p.z = 3513;
    run(p, '[queue,wilderness_warning]');
    assert.equal(p.modalMain, -1);
}
const components = [...ids.interface].filter(([name]) => name.startsWith('wilderness_warning:'));
const buttons = components.filter(([, component]) => types.Component.get(component).buttonType > 0);
assert.deepEqual(buttons.map(([name, component]) => [name, types.Component.get(component).buttonType]), [['wilderness_warning:com_73', 3]], '377 has only the native Close Window control, not enter/refuse/toggle buttons');
assert.equal(ScriptProvider.getByName('[if_button,wilderness_warning:com_73]'), undefined, 'native CLOSE_MODAL requires no invented if_button');
console.log('PASS native Close Window, movement recovery, once-per-login state and level-line suppression');
console.log('RESULT PASS Wilderness warning compiled production triggers');
process.exit(0);
