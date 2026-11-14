// Packed production scripts and native dialogue resumes. No server is started.
// Sibling engine: node --import tsx ../content/tests/ana-barrel/test_ana_barrel.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
    types[name] = await load(`cache/config/${name}.ts`); types[name].load(pack);
}
const DbTableIndex = await load('cache/config/DbTableIndex.ts'); DbTableIndex.init();
assert.ok(ScriptProvider.load(pack) > 0, 'built production pack required');
World.currentTick = 100; World.gameMap.init();
const id = (kind, name) => { const value = types[kind].getId(name); assert.ok(value >= 0, `missing ${kind} ${name}`); return value; };
const obj = name => id('ObjType', name), varp = name => id('VarPlayerType', name);
const inv = id('InvType', 'inv'), barrel = obj('thanainabarrel');
const drop = "You drop 'Ana in a barrel' before you teleport.";
const pause = new ResumePauseButtonHandler();
const fixtures = [];
function fixture(withBarrel = false, x = 3210, z = 3410) {
    const serial = fixtures.length + 1, name = BigInt(serial);
    const p = new Player(`anabarrel${serial}`, name, name);
    p.slot = serial; p.pid = serial; p.uid = (serial << 11) | serial; World.players[serial] = p; fixtures.push(p);
    p.vars.fill(0); p.levels.fill(99); p.baseLevels.fill(99); p.stats.fill(130344310);
    p.x = x; p.z = z; p.level = 0;
    p.setVar(varp('fenk_follower_uid'), -1); p.setVar(varp('desertrescue'), 19);
    for (const name of ['airrune', 'firerune', 'lawrune']) p.invAdd(inv, obj(name), 20);
    if (withBarrel) p.invAdd(inv, barrel, 2);
    p.events = [];
    p.messageGame = text => p.events.push(['message', text, p.invTotal(inv, barrel)]); p.wrappedMessageGame = p.messageGame;
    p.write = packet => { if (packet.constructor.name === 'IfSetText') p.events.push(['text', packet.text]); };
    p.playAnimation = function (...args) { this.events.push(['animation', ...args]); return Player.prototype.playAnimation.apply(this, args); };
    p.teleport = function (...args) { this.events.push(['jump']); return Player.prototype.teleport.apply(this, args); };
    return p;
}
function run(p, name, args = [], stopAtJump = false, target = undefined) {
    const script = ScriptProvider.getByName(name); assert.ok(script, `missing ${name}`);
    const state = ScriptRunner.init(script, p, target, args);
    p.executeScript(state, true, true);
    for (let n = 0; state.execution !== ScriptState.FINISHED && n < 50; n++) {
        assert.notEqual(state.execution, ScriptState.ABORTED, `${name} aborts`);
        if (stopAtJump && p.events.some(e => e[0] === 'jump')) return state;
        if (state.execution === ScriptState.PAUSEBUTTON) assert.ok(pause.handle(new ResumePauseButton(0), p));
        else if (state.execution === ScriptState.SUSPENDED) { World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil); p.delayed = false; p.executeScript(state, true, true); }
        else assert.fail(`unexpected suspension ${state.execution}`);
    }
    assert.equal(state.execution, ScriptState.FINISHED, `${name} terminates`); return state;
}
const cases = [
    { name: 'normal', script: '[if_button,magic:varrock_teleport]', target: [3213, 3424, 0] },
    { name: 'ancient', script: '[if_button,inter_267:com_179]', target: [3097, 9881, 0], setup(p) { p.setVarBit(id('VarBitType', 'deserttreasure'), 15); p.setVar(varp('alternate_spells'), 1); } },
    { name: 'teleother recipient', script: '[if_button,teleport_option:com_97]', target: [3221, 3218, 0], setup(p) { p.setVar(varp('teleother_spell'), 61); } },
    { name: 'sigil', script: '[opheld2,mm_sigil]', target: [2702, 9173, 1], stopAtJump: true, setup(p) {
        p.setVar(varp('mm_main'), 5); p.setVarBit(id('VarBitType', 'mm_garkor'), 6);
        p.invAdd(inv, obj('mm_sigil'), 1); p.lastItem = obj('mm_sigil'); p.lastSlot = p.getInventory(inv).items.findIndex(item => item?.id === obj('mm_sigil'));
    } }
];
const failures = [];
function check(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}`, e); } }
for (const spec of cases) for (const carried of [true, false]) check(`${spec.name}, barrel=${carried}`, () => {
    const p = fixture(carried); spec.setup?.(p);
    const caster = spec.name === 'teleother recipient' ? fixture(true) : null;
    run(p, spec.script, [], spec.stopAtJump);
    assert.equal(p.level, spec.target[2]); assert.ok(Math.abs(p.x - spec.target[0]) <= 2 && Math.abs(p.z - spec.target[1]) <= 2, `${p.x},${p.z}`);
    assert.equal(p.invTotal(inv, barrel), 0, 'all barrels removed');
    const chat = p.events.findIndex(e => e[0] === 'text' && e[1].includes("You can't teleport while holding the barrel"));
    const message = p.events.findIndex(e => e[0] === 'message' && e[1] === drop);
    const animation = p.events.findIndex(e => e[0] === 'animation');
    const jump = p.events.findIndex(e => e[0] === 'jump');
    if (carried) {
        assert.ok(chat >= 0 && chat < message && message < animation && animation < jump, JSON.stringify(p.events));
        assert.equal(p.events[message][2], 0, 'barrels already deleted at drop message');
        assert.equal(p.events.filter(e => e[0] === 'message' && e[1] === drop).length, 1);
    } else { assert.equal(chat, -1); assert.equal(message, -1); }
    assert.equal(p.getVar(varp('desertrescue')), 19, 'quest stage untouched');
    if (caster) { assert.equal(caster.invTotal(inv, barrel), 2); assert.deepEqual(caster.events, [], 'only recipient affected'); }
});
check('unchecked Wilderness lever inherits normal departure cleanup without Ana chat', () => {
    const type = id('LocType', 'wildoutlever');
    let lever;
    for (let x = 49 * 64; x < 50 * 64 && !lever; x++) for (let z = 61 * 64; z < 62 * 64 && !lever; z++) lever = World.getLoc(x, z, 0, type);
    assert.ok(lever, 'published lever exists in its packed map square');
    const p = fixture(true, lever.x, lever.z);
    run(p, '[oploc1,wildoutlever]', [], false, lever);
    assert.deepEqual([p.x, p.z, p.level], [2562, 3311, 0]);
    assert.equal(p.invTotal(inv, barrel), 0);
    assert.ok(!p.events.some(e => e[0] === 'text' && e[1].includes('holding the barrel')));
    const message = p.events.findIndex(e => e[0] === 'message' && e[1] === drop);
    const departure = p.events.findIndex(e => e[0] === 'animation' && e[1] === id('SeqType', 'human_castteleport'));
    assert.ok(message >= 0 && message < departure);
    assert.equal(p.events[message][2], 0);
});
for (const [name, x, z] of [
    ['swimming', 30 * 64 + 20, 75 * 64 + 20], ['trawler', 31 * 64 + 20, 75 * 64 + 20],
    ['mime', 31 * 64 + 20, 74 * 64 + 20], ['maze', 45 * 64 + 20, 71 * 64 + 20],
    ['duel', 52 * 64 + 20, 50 * 64 + 20], ['castle wars', 37 * 64 + 30, 48 * 64 + 30],
    ['castle wars waiting', 37 * 64 + 10, 148 * 64 + 10]
]) for (const carried of [true, false]) check(`refusal ${name}, barrel=${carried}`, () => {
    const p = fixture(carried, x, z), state = run(p, '[proc,pre_tele_checks]', [(x << 14) | z]);
    assert.equal(state.popInt(), 0); assert.equal(p.invTotal(inv, barrel), carried ? 2 : 0);
    assert.equal(p.events.filter(e => ['delete', 'jump', 'animation'].includes(e[0])).length, 0);
    assert.ok(!p.events.some(e => e[0] === 'message' && e[1] === drop));
});
for (const p of fixtures) { World.players[p.slot] = null; p.cleanup(); }
console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} ana barrel: ${failures.length} failures`);
process.exit(failures.length ? 1 : 0);
