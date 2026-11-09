// Execute packed production RuneScript, including Tiffy's real menu and held-item dispatch.
// Run from the sibling engine: node --import tsx ../content/tests/wanted/commorb.mjs
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
id('varbit', 'wanted_main');
function player() {
    const p = new Player('wanted_commorb_test', 0n, 0n);
    p.uid = 1; p.pid = 1; p.lastMovement = 0; p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.packets.push({ text });
    p.wrappedMessageGame = p.messageGame;
    return p;
}
function npc(name = 'rd_teleporter_guy') {
    const type = id('npc', name);
    return new Npc(0, 2997, 3373, 1, 1, EntityLifeCycle.RESPAWN, 1, type, types.NpcType.get(type).blockwalk);
}
function run(p, name, target = npc()) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing compiled ${name}`);
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
function chooseOnce(p, r, choice) {
    const menu = r.state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
    assert(menu, `expected a compiled choice menu, got ${r.state.script.name}`);
    p.lastCom = id('interface', `multi${menu[1]}:com_${choice}`);
    r.exec = p.runScript(r.state, true, true);
    assert.notEqual(r.exec, ScriptState.ABORTED, r.state.script.name);
    return r;
}
const inventory = p => p.getInventory(id('inv', 'inv'));
const bank = p => p.getInventory(id('inv', 'bank'));
const count = (p, item, which = inventory(p)) => which.getItemCount(id('obj', item));
const chatHeadings = new Set(['npcchat', 'chat'].flatMap(prefix =>
    Array.from({ length: 4 }, (_, index) => id('interface', `${prefix}${index + 1}:com_1`))));
const text = p => p.packets.filter(packet => !chatHeadings.has(packet.component)).map(packet => packet.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
function stage6() {
    const p = player();
    // Preserve every unrelated packed field while exercising the base-571 writer.
    set(p, 'quest_wanted', -2048);
    set(p, 'quest_wanted2', -1);
    set(p, 'wanted_main', 6);
    set(p, 'wanted_contacted_savant', 0);
    set(p, 'wanted_commorb_intel', 0);
    return p;
}
function openConfirm(p, method) {
    // Real Tiffy menu -> Wanted option -> Buy One / Have One Made -> confirmation.
    const choice = method === 'buy' ? 1 : 2;
    return drive(p, run(p, '[label,wanted_tiffy_menu]'), [1, choice], true);
}
function tiffyQuest(p) {
    return drive(p, run(p, '[label,wanted_tiffy_menu]'), [1]);
}
function fillFull(p, replaceItems = []) {
    const inv = inventory(p);
    const filler = id('obj', 'bronze_sword');
    for (let slot = 0; slot < inv.capacity; slot++) inv.set(slot, { id: filler, count: 1 });
    for (const item of replaceItems) {
        inv.remove(filler, 1);
        inv.add(id('obj', item), 1);
    }
}
function assertNoOrb(p, message) {
    assert.equal(count(p, 'wanted_crystal_ball'), 0, `${message}: no held orb`);
    assert.equal(count(p, 'wanted_crystal_ball', bank(p)), 0, `${message}: no banked orb`);
}

// Buy One: insufficient coins with partial materials is non-consuming.
{
    const p = stage6();
    inventory(p).add(id('obj', 'lawrune'), 1);
    drive(p, run(p, '[label,wanted_tiffy_menu]'), [1, 1]);
    assert.equal(get(p, 'wanted_main'), 6);
    assert.equal(count(p, 'coins'), 0);
    assert.equal(count(p, 'lawrune'), 1);
    assertNoOrb(p, 'missing coins');
    assert.match(text(p), /I don't have that kind of money with me/);
    assert.match(text(p), /No, no you bring me all three components at the same time/);
}

// Have One Made: missing and partial recipes preserve every input and stage.
{
    const p = stage6();
    drive(p, run(p, '[label,wanted_tiffy_menu]'), [1, 2]);
    assert.equal(get(p, 'wanted_main'), 6);
    assertNoOrb(p, 'missing recipe');
    assert.match(text(p), /Bring me one Law Rune, one Slayer Gem and one piece of Molten Glass/);
}
{
    const p = stage6();
    inventory(p).add(id('obj', 'lawrune'), 1);
    inventory(p).add(id('obj', 'slayer_gem'), 1);
    drive(p, run(p, '[label,wanted_tiffy_menu]'), [1, 2]);
    assert.equal(get(p, 'wanted_main'), 6);
    assert.equal(count(p, 'lawrune'), 1);
    assert.equal(count(p, 'slayer_gem'), 1);
    assert.equal(count(p, 'molten_glass'), 0);
    assertNoOrb(p, 'partial recipe');
    assert.match(text(p), /Can I give you the components I have with me now/);
    assert.match(text(p), /No, no you bring me all three components at the same time/);
}
console.log('PASS missing coins and missing/partial material refusals preserve exact inventory and stage');

// Declining either confirmation is a non-transaction.
{
    const p = stage6();
    inventory(p).add(id('obj', 'coins'), 10000);
    const pending = openConfirm(p, 'buy');
    assert.equal(get(p, 'wanted_main'), 6);
    assert.equal(count(p, 'coins'), 10000);
    assertNoOrb(p, 'before Buy One confirmation');
    drive(p, pending, [2]);
    assert.equal(get(p, 'wanted_main'), 6);
    assert.equal(count(p, 'coins'), 10000);
    assertNoOrb(p, 'declined Buy One');
    assert.match(text(p), /Actually, no thanks/);
}
{
    const p = stage6();
    for (const item of ['lawrune', 'slayer_gem', 'molten_glass']) inventory(p).add(id('obj', item), 1);
    const pending = openConfirm(p, 'make');
    drive(p, pending, [2]);
    assert.equal(get(p, 'wanted_main'), 6);
    for (const item of ['lawrune', 'slayer_gem', 'molten_glass']) assert.equal(count(p, item), 1);
    assertNoOrb(p, 'declined Have One Made');
    assert.match(text(p), /Actually, no thanks/);
}
console.log('PASS declining both confirmation menus consumes nothing and does not advance stage 6');

// An interrupted confirmation remains stage 6 with its original payment intact.
{
    const p = stage6();
    inventory(p).add(id('obj', 'coins'), 10000);
    const pending = openConfirm(p, 'buy');
    assert.equal(pending.exec, ScriptState.PAUSEBUTTON);
    assert.equal(get(p, 'wanted_main'), 6);
    assert.equal(count(p, 'coins'), 10000);
    assertNoOrb(p, 'interrupted purchase');
}
console.log('PASS interruption at the offer leaves all payment and stage bits unchanged');

// Buy One refuses full capacity before deducting even when the exact coin stack could free its slot.
{
    const p = stage6();
    fillFull(p, ['coins']);
    inventory(p).add(id('obj', 'coins'), 9999);
    assert.equal(inventory(p).getItemCount(id('obj', 'bronze_sword')), inventory(p).capacity - 1);
    const before = count(p, 'coins');
    drive(p, run(p, '[label,wanted_tiffy_menu]'), [1, 1]);
    assert.equal(get(p, 'wanted_main'), 6);
    assert.equal(count(p, 'coins'), before);
    assertNoOrb(p, 'full-inventory Buy One');
    assert.match(text(p), /you'll need to free up some inventory space first/);
}
console.log('PASS Buy One refuses full inventory before consuming the exact coin stack');

// A full inventory may use Have One Made: the consumed materials free the output slot.
{
    const p = stage6();
    fillFull(p, ['lawrune', 'slayer_gem', 'molten_glass']);
    assert.equal(inventory(p).getItemCount(id('obj', 'bronze_sword')), inventory(p).capacity - 3);
    const pending = openConfirm(p, 'make');
    assert.equal(get(p, 'wanted_main'), 6);
    assert.equal(count(p, 'wanted_crystal_ball'), 0);
    drive(p, pending, [1]);
    assert.equal(get(p, 'wanted_main'), 7);
    for (const item of ['lawrune', 'slayer_gem', 'molten_glass']) assert.equal(count(p, item), 0);
    assert.equal(count(p, 'wanted_crystal_ball'), 1);
    assert.equal(inventory(p).getItemCount(id('obj', 'bronze_sword')), inventory(p).capacity - 3);
}
console.log('PASS Have One Made consumes all three exact inputs and frees space from a full inventory');

// Recheck after each yielding confirmation: stale resources or a changed stage cannot charge or issue.
{
    const p = stage6();
    inventory(p).add(id('obj', 'coins'), 10000);
    const pending = openConfirm(p, 'buy');
    inventory(p).remove(id('obj', 'coins'), 10000);
    chooseOnce(p, pending, 1);
    assert.equal(get(p, 'wanted_main'), 6);
    assert.equal(count(p, 'coins'), 0);
    assertNoOrb(p, 'stale coin confirmation');
}
{
    const p = stage6();
    for (const item of ['lawrune', 'slayer_gem', 'molten_glass']) inventory(p).add(id('obj', item), 1);
    const pending = openConfirm(p, 'make');
    inventory(p).remove(id('obj', 'slayer_gem'), 1);
    chooseOnce(p, pending, 1);
    assert.equal(get(p, 'wanted_main'), 6);
    assert.equal(count(p, 'lawrune'), 1);
    assert.equal(count(p, 'slayer_gem'), 0);
    assert.equal(count(p, 'molten_glass'), 1);
    assertNoOrb(p, 'stale material confirmation');
}
{
    const p = stage6();
    inventory(p).add(id('obj', 'coins'), 10000);
    const pending = openConfirm(p, 'buy');
    set(p, 'wanted_main', 7);
    chooseOnce(p, pending, 1);
    assert.equal(get(p, 'wanted_main'), 7);
    assert.equal(count(p, 'coins'), 10000);
    assertNoOrb(p, 'stale stage confirmation');
}
console.log('PASS acceptance rechecks stage and complete payment inputs after the yielding choice');

// Buy One commits the exact exchange and packed stage before its first post-confirmation yield.
{
    const p = stage6();
    inventory(p).add(id('obj', 'coins'), 10000);
    set(p, 'wanted_contacted_savant', 1);
    const high = get(p, 'quest_wanted') & ~2047;
    const pending = openConfirm(p, 'buy');
    assert.equal(get(p, 'wanted_main'), 6);
    chooseOnce(p, pending, 1);
    assert.equal(pending.exec, ScriptState.PAUSEBUTTON);
    assert.equal(get(p, 'wanted_main'), 7);
    assert.equal(count(p, 'coins'), 0);
    assert.equal(count(p, 'wanted_crystal_ball'), 1);
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
    assert.equal(get(p, 'quest_wanted') & ~2047, high);
    assert.equal(get(p, 'quest_wanted2'), -1);
}

// The ordinary free-space material exchange also commits stage and items exactly once.
{
    const p = stage6();
    for (const item of ['lawrune', 'slayer_gem', 'molten_glass']) inventory(p).add(id('obj', item), 1);
    const pending = openConfirm(p, 'make');
    chooseOnce(p, pending, 1);
    assert.equal(pending.exec, ScriptState.PAUSEBUTTON);
    assert.equal(get(p, 'wanted_main'), 7);
    for (const item of ['lawrune', 'slayer_gem', 'molten_glass']) assert.equal(count(p, item), 0);
    assert.equal(count(p, 'wanted_crystal_ball'), 1);
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
    assert.equal(get(p, 'quest_wanted2'), -1);
}
console.log('PASS both successful exchange routes commit stage 6→7 with exact deltas and preserve packed bits');

// Recovery is free, stage-neutral, inventory/bank aware, and never clears intelligence.
for (const stage of [7, 8, 9, 10, 11]) {
    const p = player();
    set(p, 'wanted_main', stage);
    const intel = stage >= 8 ? 1 : 0;
    set(p, 'wanted_commorb_intel', intel);
    set(p, 'wanted_contacted_savant', intel);
    tiffyQuest(p);
    assert.equal(get(p, 'wanted_main'), stage, `replacement at stage ${stage} does not advance quest`);
    assert.equal(count(p, 'wanted_crystal_ball'), 1, `replacement at stage ${stage}`);
    assert.equal(count(p, 'wanted_crystal_ball', bank(p)), 0);
    assert.equal(get(p, 'wanted_commorb_intel'), intel, `replacement preserves intelligence at stage ${stage}`);
    assert.equal(get(p, 'wanted_contacted_savant'), intel, `replacement preserves contact at stage ${stage}`);
    assert.match(text(p), /Very careless of you, what\? Here, take another, but be careful of this one/);
    if (intel === 0) {
        assert.match(text(p), /You are hunting for Solus Dellagar/);
        assert.match(text(p), /contact Savant through your CommOrb/);
    }
}
console.log('PASS free missing-orb recovery at stages 7–11 preserves contact/intelligence bits');

// A held orb gets the recorded first-use prompt, not a second orb.
{
    const p = player();
    set(p, 'wanted_main', 7);
    inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    tiffyQuest(p);
    assert.equal(get(p, 'wanted_main'), 7);
    assert.equal(count(p, 'wanted_crystal_ball'), 1);
    assert.match(text(p), /You are hunting for Solus Dellagar/);
    assert.match(text(p), /contact Savant through your CommOrb/);
}

// Bank-only and held+banked ownership suppresses replacement; no floor lookup is involved.
for (const stage of [7, 8, 9, 10, 11]) {
    const p = player();
    set(p, 'wanted_main', stage);
    set(p, 'wanted_commorb_intel', stage >= 8 ? 1 : 0);
    set(p, 'wanted_contacted_savant', stage >= 8 ? 1 : 0);
    bank(p).add(id('obj', 'wanted_crystal_ball'), 1);
    tiffyQuest(p);
    if (stage === 7) assert.match(text(p), /contact Savant through your CommOrb/);
    assert.equal(get(p, 'wanted_main'), stage);
    assert.equal(count(p, 'wanted_crystal_ball'), 0);
    assert.equal(count(p, 'wanted_crystal_ball', bank(p)), 1);
}
{
    const p = player();
    set(p, 'wanted_main', 9);
    set(p, 'wanted_commorb_intel', 1);
    set(p, 'wanted_contacted_savant', 1);
    inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    bank(p).add(id('obj', 'wanted_crystal_ball'), 1);
    tiffyQuest(p);
    assert.equal(count(p, 'wanted_crystal_ball'), 1);
    assert.equal(count(p, 'wanted_crystal_ball', bank(p)), 1);
    assert.equal(get(p, 'wanted_commorb_intel'), 1);
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
}
console.log('PASS held or banked ownership suppresses duplicate free replacements and leaves intelligence intact');

// A full inventory does not hand out a free replacement into nowhere.
{
    const p = player();
    set(p, 'wanted_main', 8);
    set(p, 'wanted_commorb_intel', 1);
    set(p, 'wanted_contacted_savant', 1);
    fillFull(p);
    tiffyQuest(p);
    assert.equal(get(p, 'wanted_main'), 8);
    assert.equal(count(p, 'wanted_crystal_ball'), 0);
    assert.equal(get(p, 'wanted_commorb_intel'), 1);
}
// Direct quest entry has no menu/greeting text to obscure a fabricated response.
for (const held of [false, true]) {
    const p = player();
    set(p, 'wanted_main', 8);
    set(p, 'wanted_commorb_intel', 1);
    if (held) inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    else fillFull(p);
    drive(p, run(p, '[label,wanted_tiffy_quest]'));
    assert.equal(text(p), '', held ? 'no recorded stage-8 held-orb reminder' : 'no recorded full-inventory replacement refusal');
    assert.equal(get(p, 'wanted_main'), 8);
    assert.equal(count(p, 'wanted_crystal_ball'), held ? 1 : 0);
}

// Actual held operations 1/2 both reach Savant Contact without advancing stage or assignment;
// operation 4 reaches the parent's real Playback selector and remains progress-neutral.
for (const op of [1, 2]) {
    const p = player();
    set(p, 'wanted_main', 7);
    inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    const result = drive(p, run(p, `[opheld${op},wanted_crystal_ball]`, null), [], true);
    assert.notEqual(result.exec, ScriptState.ABORTED);
    assert.equal(get(p, 'wanted_main'), 7);
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
    assert.equal(count(p, 'wanted_crystal_ball'), 1);
    assert.match(text(p), /Savant/);
}
{
    const p = player();
    set(p, 'wanted_main', 8);
    set(p, 'wanted_commorb_intel', 1);
    set(p, 'wanted_contacted_savant', 1);
    set(p, 'wanted_daquarius_hint', 0);
    set(p, 'wanted_zammy_mage_hint', 0);
    inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    const result = drive(p, run(p, '[opheld1,wanted_crystal_ball]', null), [], true);
    assert.notEqual(result.exec, ScriptState.ABORTED);
    assert.equal(get(p, 'wanted_main'), 8);
    assert.equal(get(p, 'wanted_commorb_intel'), 1);
    assert.equal(get(p, 'wanted_daquarius_hint'), 0);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), 0);
    assert.match(text(p), /Savant/);
}
{
    const p = player();
    set(p, 'wanted_main', 8);
    set(p, 'wanted_commorb_intel', 1);
    set(p, 'wanted_contacted_savant', 1);
    inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    const result = drive(p, run(p, '[opheld4,wanted_crystal_ball]', null), [], true);
    assert.notEqual(result.exec, ScriptState.ABORTED);
    assert.equal(get(p, 'wanted_main'), 8);
    assert.equal(get(p, 'wanted_commorb_intel'), 1);
    assert.equal(count(p, 'wanted_crystal_ball'), 1);
    assert.match(text(p), /Record 1/);
    assert.match(text(p), /Record 2/);
    assert.match(text(p), /Dossiers/);
    assert.match(text(p), /Cancel/);
}
console.log('PASS real held Scan/Contact/Playback dispatch uses the compiled handlers without false chase progress');

// The Wanted option and all original Tiffy services remain present after deputising.
{
    const p = player();
    set(p, 'wanted_main', 7);
    const menu = drive(p, run(p, '[label,wanted_tiffy_menu]'), [], true);
    const menuText = text(p);
    assert.equal(menu.exec, ScriptState.PAUSEBUTTON);
    assert.match(menuText, /Ask about the Wanted! Quest/);
    assert.match(menuText, /Gaze of Saradomin/);
    assert.match(menuText, /Can I buy some armour/);
    assert.match(menuText, /switch respawns/);
    assert.equal(get(p, 'wanted_main'), 7);
}
console.log('PASS Tiffy Wanted question remains alongside Gaze, armour and respawn services');
console.log('RESULT PASS Wanted S3 compiled Commorb handlers');
process.exit(0);
