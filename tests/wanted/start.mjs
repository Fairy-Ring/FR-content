// Execute packed production RuneScript, including menus and shared NPC dispatch.
// Run from the sibling engine: node --import tsx ../content/tests/wanted/start.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(engine, rel)).href)).default;
const World = await load('src/engine/World.ts');
const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
const ScriptState = await load('src/engine/script/ScriptState.ts');
const Player = await load('src/engine/entity/Player.ts');
const Npc = await load('src/engine/entity/Npc.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component']) {
    types[name] = await load(`src/cache/config/${name}.ts`);
    types[name].load(pack);
}
assert(ScriptProvider.load(pack) > 0);
World.currentTick = 1;
const maps = {};
function id(kind, name) {
    maps[kind] ??= new Map(fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8').split('\n').filter(x => /^\d+=/.test(x)).map(x => { const at = x.indexOf('='); return [x.slice(at + 1).trim(), Number(x.slice(0, at))]; }));
    const value = maps[kind].get(name);
    assert.notEqual(value, undefined, `${kind}:${name}`);
    return value;
}
function set(p, name, value) {
    if (maps.varbit?.has(name) ?? fs.readFileSync(path.join(content, 'pack/varbit.pack'), 'utf8').includes(`=${name}\n`)) p.setVarBit(id('varbit', name), value);
    else p.setVar(id('varp', name), value);
}
function get(p, name) {
    return maps.varbit?.has(name) ? p.getVarBit(id('varbit', name)) : p.getVar(id('varp', name));
}
// Prime the bit map before get/set distinguish fields.
id('varbit', 'wanted_main');
function player() {
    const p = new Player('wanted_test', 0n, 0n);
    p.uid = 1; p.pid = 1; p.lastMovement = 0; p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.packets.push({ text });
    p.wrappedMessageGame = p.messageGame;
    return p;
}
function qualified() {
    const p = player();
    // Disclosed unit fixtures. These quest states produce exactly 32 real QP.
    for (const [name, value] of Object.entries({ rd_main: 2, priestperil: 60, lost_tribe_quest: 11, runemysteries: 6, spy: 4, druidquest: 4, rjquest: 100, goblinquest: 6, haunted: 3, demonstart: 30, vampire: 3, cookquest: 2 })) set(p, name, value);
    return p;
}
function npc(name) {
    const type = id('npc', name);
    return new Npc(0, 2997, 3373, 1, 1, EntityLifeCycle.RESPAWN, 1, type, types.NpcType.get(type).blockwalk);
}
function run(p, name, target = npc('rd_teleporter_guy')) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing ${name}`);
    const state = ScriptRunner.init(script, p, target);
    const result = { state, exec: p.runScript(state, true, true) };
    assert.notEqual(result.exec, ScriptState.ABORTED, name);
    return result;
}
function drive(p, r, choices = [], stopAtMenu = false) {
    let pauses = 0;
    while (r.exec === ScriptState.PAUSEBUTTON && pauses++ < 300) {
        const menu = r.state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
        if (menu) {
            if (stopAtMenu && choices.length === 0) return r;
            assert(choices.length > 0, `unanswered ${r.state.script.name}`);
            p.lastCom = id('interface', `multi${menu[1]}:com_${choices.shift()}`);
        }
        r.exec = p.runScript(r.state, true, true);
        assert.notEqual(r.exec, ScriptState.ABORTED, r.state.script.name);
    }
    assert.equal(r.exec, ScriptState.FINISHED, `unexpected execution ${r.exec}`);
    assert.equal(choices.length, 0);
    return r;
}
function talk(p, who, choices) { return drive(p, run(p, `[opnpc1,${who}]`, npc(who)), choices); }
function eligible(p) { const r = run(p, '[proc,wanted_requirements_met]'); assert.equal(r.exec, ScriptState.FINISHED); return r.state.popInt(); }
const stage = p => get(p, 'wanted_main');
const inventory = p => p.getInventory(id('inv', 'inv'));
const text = p => p.packets.map(x => x.text ?? '').join('\n');

for (const [name, below] of [['rd_main', 1], ['priestperil', 59], ['lost_tribe_quest', 10], ['runemysteries', 5]]) {
    const p = qualified(); set(p, name, below); set(p, 'doricquest', 100);
    assert.equal(eligible(p), 0, `${name} below requirement`);
    assert.equal(get(p, 'qp'), 32, 'independent gate with 32 recomputed QP');
    assert.equal(stage(p), 0);
}
{
    const p = qualified(); set(p, 'cookquest', 0); set(p, 'qp', 999);
    assert.equal(eligible(p), 0); assert.equal(get(p, 'qp'), 31, 'do not trust forced QP display');
    set(p, 'cookquest', 2); assert.equal(eligible(p), 1); assert.equal(get(p, 'qp'), 32);
    set(p, 'lost_tribe_quest', 12); assert.equal(eligible(p), 1, 'Lost Tribe preserves registered >= terminal predicate');
}
for (const [priestperil, expected] of [[59, 0], [60, 1], [61, 1]]) {
    const p = qualified(); set(p, 'priestperil', priestperil);
    if (priestperil === 59) set(p, 'doricquest', 100);
    assert.equal(eligible(p), expected, `Priest in Peril ${priestperil}: registered >= completion predicate`);
    assert.equal(get(p, 'qp'), 32, 'Priest in Peril boundary has 32 recomputed QP');
}
console.log('PASS requirements: four independent gates, real 31/32 QP recount, Lost Tribe registry predicate');
// Exercise opnpc1, not the Wanted label alone. The player greeting deliberately
// pauses before Amik's first NPC page, exactly as in the retained route probe.
for (const [s, firstWantedLine] of [
    [1, "Well, I did have something you may have been interested in, but I've been given orders not to approach you for trivial matters now that you are a member of the Temple Knights."],
    [2, "Well, I did have something you may be interested in, but I've been given orders not to-"],
    [3, 'Yes, yes in fact I do. I would like you to bring me an Asgarnian Ale.'],
    [4, 'Only to become my Squire. Do you wish to become my squire?'],
    [5, 'Thank Saradomin you have come back here!']
]) {
    const p = qualified(); set(p, 'wanted_main', s);
    const r = run(p, '[opnpc1,sir_amik_varze]', npc('sir_amik_varze'));
    assert.equal(r.exec, ScriptState.PAUSEBUTTON, `stage ${s}: player greeting pauses`);
    assert.match(text(p), /Hello Sir Amik\./);
    assert.doesNotMatch(text(p), /Hello, friend!/, 'Amik waits for the player Continue');
    const npcPages = [];
    for (let pauses = 0; r.exec === ScriptState.PAUSEBUTTON && npcPages.length < 2 && pauses < 30; pauses++) {
        p.packets.length = 0;
        r.exec = p.runScript(r.state, true, true);
        assert.notEqual(r.exec, ScriptState.ABORTED);
        const page = p.packets.filter(x => x.constructor.name === 'IfSetText');
        for (const lines of [1, 2, 3, 4]) {
            if (page.some(x => x.component === id('interface', `npcchat${lines}:com_1`) && x.text === 'Sir Amik Varze')) {
                npcPages.push(page.filter(x => Array.from({ length: lines }, (_, n) => id('interface', `npcchat${lines}:com_${n + 2}`)).includes(x.component)).map(x => x.text).join(' ').replace(/\s+/g, ' ').trim());
            }
        }
    }
    assert.deepEqual(npcPages, ['Hello, friend!', firstWantedLine], `stage ${s}: Amik's first shared and Wanted NPC pages match the records`);
    assert.equal(stage(p), s, 'reading the first NPC lines does not advance Wanted');
}
console.log('PASS Amik opnpc1 stages 1/2/3/4/5: player Continue, NPC greeting and first Wanted line');
{
    const p = qualified();
    const interrupted = drive(p, run(p, '[opnpc1,rd_teleporter_guy]'), [1], true);
    assert.equal(stage(p), 0, 'offer interruption writes nothing');
    assert.equal(interrupted.exec, ScriptState.PAUSEBUTTON);
    // Fresh dispatch represents interruption, without resuming its stale continuation.
    talk(p, 'rd_teleporter_guy', [1, 2, 5]); assert.equal(stage(p), 0, 'refusal returns to services');
    talk(p, 'rd_teleporter_guy', [1, 1]); assert.equal(stage(p), 1);
    talk(p, 'sir_amik_varze', []); assert.equal(stage(p), 1); assert.match(text(p), /trivial matters/);
    const instructions = drive(p, run(p, '[opnpc1,rd_teleporter_guy]'), [1], true);
    assert.equal(stage(p), 2, 'core instructions commit before optional questions');
    drive(p, instructions, [1, 1, 2]); assert.equal(stage(p), 2, 'all plan questions are non-gating');
    const worn = p.getInventory(id('inv', 'worn'));
    for (const item of ['basic_tk_helm', 'basic_tk_body', 'basic_tk_legs']) worn.add(id('obj', item), 1);
    const amikMenu = drive(p, run(p, '[opnpc1,sir_amik_varze]', npc('sir_amik_varze')), [], true);
    assert.equal(get(p, 'wanted_joke_option'), 1); assert.equal(stage(p), 2);
    drive(p, amikMenu, [1, 3]); assert.equal(stage(p), 4, 'no-crisis is not deputising');
    talk(p, 'sir_amik_varze', []); assert.equal(stage(p), 4);
    talk(p, 'rd_teleporter_guy', [1]); assert.equal(stage(p), 5);
    talk(p, 'rd_teleporter_guy', [1]); assert.equal(stage(p), 5, 'Tiffy cannot skip Amik');
    talk(p, 'sir_amik_varze', [1, 2, 4]); assert.equal(stage(p), 5, 'information/refusal do not deputise');
    talk(p, 'sir_amik_varze', [3]); assert.equal(stage(p), 6);
    talk(p, 'sir_amik_varze', []); assert.equal(stage(p), 6);
    assert.equal(inventory(p).getItemCount(id('obj', 'wanted_crystal_ball')), 0);
    assert.equal(get(p, 'rd_main'), 2); assert.equal(get(p, 'wanted_joke_option'), 1);
    assert.equal(get(p, 'qp'), 32, 'no S2 quest-point reward');
}
console.log('PASS real shared dispatch: interruption/refusal, plan questions, quip, crisis, all deputy choices and reminders');
{
    const p = qualified(); talk(p, 'rd_teleporter_guy', [1, 1]); talk(p, 'rd_teleporter_guy', [1, 3]);
    talk(p, 'sir_amik_varze', [2]); assert.equal(stage(p), 3);
    const ale = id('obj', 'asgarnian_ale'); const mature = id('obj', 'mature_asgarnian_ale');
    inventory(p).add(mature, 1); talk(p, 'sir_amik_varze', []); assert.equal(inventory(p).getItemCount(mature), 1);
    inventory(p).add(ale, 2);
    for (const remaining of [1, 0]) { talk(p, 'sir_amik_varze', []); assert.equal(inventory(p).getItemCount(ale), remaining); assert.equal(stage(p), 3); }
    talk(p, 'rd_teleporter_guy', [1]); assert.equal(stage(p), 5);
    talk(p, 'sir_amik_varze', [3]); assert.equal(stage(p), 6);
}
console.log('PASS squire: ordinary ale only, repeat consumption, no reward, recovery to deputising');
for (const [initial, next, label, choices] of [[0, 1, 'wanted_tiffy_start', [1]], [1, 2, 'wanted_tiffy_plan', [3]], [2, 3, 'wanted_amik_squire_menu', [2]], [2, 4, 'wanted_amik_squire_menu', [3]], [3, 5, 'wanted_tiffy_squire_crisis', []], [4, 5, 'wanted_tiffy_crisis', []], [5, 6, 'wanted_amik_deputise_menu', [3]]]) {
    const p = qualified(); set(p, 'quest_wanted', -2048); set(p, 'wanted_main', initial); set(p, 'quest_wanted2', -1);
    const high = get(p, 'quest_wanted') & ~2047;
    drive(p, run(p, `[label,${label}]`), choices);
    assert.equal(stage(p), next); assert.equal(get(p, 'quest_wanted') & ~2047, high); assert.equal(get(p, 'quest_wanted2'), -1);
}
console.log('PASS every S2 writer preserves all adjacent packed fields and base572');
for (const s of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const p = qualified(); set(p, 'wanted_main', s);
    drive(p, run(p, '[if_button,questlist:wanted]'));
    assert.match(text(p), s === 0 ? /32 Quest Points/ : s <= 6 ? /Sir (?:Tiffy|Amik)/ : /Commorb/);
    run(p, '[proc,wanted_update_progress]');
    const colour = p.packets.findLast(x => x.constructor.name === 'IfSetColour');
    assert(colour, `quest colour stage${s}`);
}
console.log('RESULT PASS Wanted S2 compiled production handlers');
process.exit(0);
