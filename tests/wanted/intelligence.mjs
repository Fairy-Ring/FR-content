// Production ScriptRunner coverage for Wanted S4 handlers.
// Run from the sibling engine: node --import tsx ../content/tests/wanted/intelligence.mjs
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
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'ParamType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType']) {
    types[name] = await load(`src/cache/config/${name}.ts`);
    types[name].load(pack);
}
const DbTableIndex = await load('src/cache/config/DbTableIndex.ts');
DbTableIndex.init();
assert(ScriptProvider.load(pack) > 0);
World.currentTick = 1;
const maps = {};
function id(kind, name) {
    maps[kind] ??= new Map(fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8').split('\n').filter(line => /^\d+=/.test(line)).map(line => {
        const at = line.indexOf('=');
        return [line.slice(at + 1).trim(), Number(line.slice(0, at))];
    }));
    const value = maps[kind].get(name);
    assert.notEqual(value, undefined, `${kind}:${name}`);
    return value;
}
function set(p, name, value) {
    if (maps.varbit?.has(name) ?? fs.readFileSync(path.join(content, 'pack/varbit.pack'), 'utf8').includes(`=${name}\n`)) {
        p.setVarBit(id('varbit', name), value);
    } else {
        p.setVar(id('varp', name), value);
    }
}
function get(p, name) {
    return maps.varbit?.has(name) ? p.getVarBit(id('varbit', name)) : p.getVar(id('varp', name));
}
for (const name of ['wanted_main', 'wanted_daquarius_hint', 'wanted_zammy_mage_hint', 'wanted_black_knight_dead', 'wanted_lord_d_exposition']) id('varbit', name);
const inventory = p => p.getInventory(id('inv', 'inv'));
const bank = p => p.getInventory(id('inv', 'bank'));
const count = (p, item, which = inventory(p)) => which.getItemCount(id('obj', item));
const chatHeadings = new Set(['npcchat', 'chat'].flatMap(prefix =>
    Array.from({ length: 4 }, (_, index) => id('interface', `${prefix}${index + 1}:com_1`))));
const text = p => p.packets.filter(packet => !chatHeadings.has(packet.component)).map(packet => packet.text ?? '').join('\n').replace(/\s+/g, ' ').trim();
const clearText = p => { p.packets.length = 0; };
let playerSerial = 0;
let npcSerial = 0;
function player(stage = 8) {
    const serial = ++playerSerial;
    const hash64 = BigInt(0x100000 + serial);
    const username37 = BigInt(serial);
    const p = new Player(`wanted_s4_${serial}`, username37, hash64);
    p.slot = serial;
    p.uid = (Number(username37 & 0x1fffffn) << 11) | serial;
    p.pid = serial;
    p.lastMovement = 0;
    p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = message => p.packets.push({ text: message });
    p.wrappedMessageGame = p.messageGame;
    set(p, 'quest_wanted', -2048);
    set(p, 'quest_wanted2', -1);
    set(p, 'wanted_black_knight_dead', 0);
    set(p, 'wanted_main', stage);
    set(p, 'wanted_contacted_savant', 0);
    set(p, 'wanted_commorb_intel', 1);
    set(p, 'wanted_daquarius_hint', 0);
    set(p, 'wanted_zammy_mage_hint', 0);
    World.players[serial] = p;
    set(p, 'wanted_lord_d_exposition', 0);
    World.playerLoop.add(hash64, p);
    return p;
}
function npc(name, x = 2997, z = 3373) {
    const type = id('npc', name);
    return new Npc(0, x, z, 1, 1, EntityLifeCycle.RESPAWN, ++npcSerial, type, types.NpcType.get(type).blockwalk);
}
function run(p, name, target = npc('rd_teleporter_guy')) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing ${name}`);
    const state = ScriptRunner.init(script, p, target);
    const result = { state, target, exec: p.runScript(state, true, true) };
    assert.notEqual(result.exec, ScriptState.ABORTED, name);
    return result;
}
function drive(p, result, choices = []) {
    while (result.exec === ScriptState.NPC_SUSPENDED) {
        result.target.executeScript(result.state);
        result.exec = result.state.execution;
    }
    let pauses = 0;
    while (result.exec === ScriptState.PAUSEBUTTON && pauses++ < 500) {
        const menu = result.state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
        if (menu) {
            assert(choices.length > 0, `unanswered ${result.state.script.name}`);
            p.lastCom = id('interface', `multi${menu[1]}:com_${choices.shift()}`);
        }
        World.currentTick++;
        result.exec = p.runScript(result.state, true, true);
        assert.notEqual(result.exec, ScriptState.ABORTED, result.state.script.name);
    }
    assert.equal(result.exec, ScriptState.FINISHED, `unexpected execution ${result.exec}`);
    assert.equal(choices.length, 0);
    return result;
}
function talk(p, who, choices = []) {
    return drive(p, run(p, `[opnpc1,${who}]`, npc(who)), choices);
}
function creditedDeath(p, trigger, type, x, z) {
    p.closeModal(false);
    const target = npc(type, x, z);
    target.heroPoints.addHero(p.hash64, 10);
    target.setVar(id('varn', 'npc_aggressive_player'), p.uid);
    const before = World.gameMap.getTotalObjs();
    const result = drive(p, run(p, `[ai_queue3,${trigger}]`, target));
    return { target, before, after: World.gameMap.getTotalObjs(), result };
}
function prepareMage(p, who) {
    talk(p, 'lord_daquarius');
    assert.equal(get(p, 'wanted_daquarius_hint'), 1);
    creditedDeath(p, 'black_knight', 'black_knight', 2400, 3600);
    assert.equal(get(p, 'wanted_black_knight_dead'), 1);
    talk(p, 'lord_daquarius');
    assert.equal(get(p, 'wanted_daquarius_hint'), 2);
    talk(p, who);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), 1);
}

// STEP 1/2: the refusal, kill attribution, unrestricted location, clue, no-credit control, and jailer control.
{
    const p = player(8);
    const initialQuest2 = p.getVar(id('varp', 'quest_wanted2')) & ~((1 << 24) | (1 << 25));
    talk(p, 'lord_daquarius');
    assert.equal(get(p, 'wanted_daquarius_hint'), 1);
    assert.equal(get(p, 'wanted_lord_d_exposition'), 1);
    assert.match(text(p), /I will help neither of you, and I wish you all a slow and painful death/);
    assert.equal(get(p, 'wanted_main'), 8);
    const initialQuest = p.getVar(id('varp', 'quest_wanted')) & ~(2047 | (3 << 14) | (3 << 16));

    const beforeUncredited = p.getVar(id('varp', 'quest_wanted2'));
    const uncredited = npc('black_knight', 2401, 3601);
    drive(p, run(p, '[ai_queue3,black_knight]', uncredited));
    assert.equal(get(p, 'wanted_black_knight_dead'), 0, 'unattributed ordinary Black Knight is not witness evidence');
    assert.equal(p.getVar(id('varp', 'quest_wanted2')) & ~((1 << 24) | (1 << 25)), beforeUncredited & ~((1 << 24) | (1 << 25)));

    const beforeJailer = World.gameMap.getTotalObjs();
    const jailer = creditedDeath(p, 'jailer', 'jailer', 2402, 3602);
    assert.equal(get(p, 'wanted_black_knight_dead'), 0, 'credited jailer is not an ordinary Black Knight');
    assert(jailer.after > beforeJailer, 'jailer still drops its normal jail key');

    const remoteKnight = creditedDeath(p, 'black_knight', 'black_knight', 2500, 3700);
    assert.equal(get(p, 'wanted_black_knight_dead'), 1, 'remote credited ordinary Black Knight satisfies D12');
    assert(remoteKnight.after > remoteKnight.before, 'normal Black Knight death still runs its drop table');
    assert.equal(p.getVar(id('varp', 'quest_wanted2')) & ~((1 << 24) | (1 << 25)), initialQuest2);
    talk(p, 'lord_daquarius');
    assert.equal(get(p, 'wanted_daquarius_hint'), 2);
    assert.match(text(p), /It was not bear fur, I know that much/);
    assert.equal(p.getVar(id('varp', 'quest_wanted')) & ~(2047 | (3 << 14) | (3 << 16)), initialQuest);
}

// The plan does not require a first Daquarius talk before a credited kill.
{
    const p = player(8);
    creditedDeath(p, 'black_knight', 'black_knight', 2501, 3701);
    assert.equal(get(p, 'wanted_black_knight_dead'), 1);
    talk(p, 'lord_daquarius');
    assert.equal(get(p, 'wanted_daquarius_hint'), 2);
    assert.match(text(p), /It was not bear fur, I know that much/);
}

// STEP 4: both mage identities refuse to pay or deduce before the fur clue, then share the same recorded flow.
for (const who of ['rcu_zammy_mage1a', 'rcu_zammy_mage1_edgeb']) {
    const p = player(8);
    inventory(p).add(id('obj', 'blankrune'), 20);
    const before = count(p, 'blankrune');
    talk(p, who);
    assert.equal(count(p, 'blankrune'), before, `${who}: early access cannot consume essence`);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), 0, `${who}: early access cannot set mage evidence`);
    assert.doesNotMatch(text(p), /Daquarius told us|moved East of here/);
    prepareMageAfterRefusal(p, who);
    clearText(p);
    talk(p, who);
    assert.equal(get(p, 'wanted_main'), 9);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), 2);
    assert(p.packets.some(packet => packet.constructor.name === 'IfSetColour'), `${who}: stage 9 refreshes progress colour`);
    assert.equal(count(p, 'blankrune'), 0, `${who}: exactly 20 unnoted essence paid`);
    assert.match(text(p), /moved East of here when he left me/);
    assert.match(text(p), /Wolf fur\.\.\. and the East\.\.\. I know where he is/);
    assert.equal((text(p).match(/Daquarius told us/g) ?? []).length, 1, `${who}: deduction tail plays once after both clues`);
    clearText(p);
    talk(p, who);
    assert.equal(get(p, 'wanted_main'), 9);
    assert.equal(count(p, 'blankrune'), 0, `${who}: repeat talk does not charge again`);
    assert.equal(text(p), '', `${who}: completed deduction is not replayed`);
}

// The helper starts after both Daquarius clues and the mage's recorded price are known.
function prepareMageAfterRefusal(p, who) {
    talk(p, 'lord_daquarius');
    assert.equal(get(p, 'wanted_daquarius_hint'), 1);
    creditedDeath(p, 'black_knight', 'black_knight', 2400, 3600);
    talk(p, 'lord_daquarius');
    assert.equal(get(p, 'wanted_daquarius_hint'), 2);
    talk(p, who);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), 1);
}

// STEP 3: each disallowed form leaves every offered item untouched; 20 plain essence is paid once.
const invalidOffers = [
    ['nineteen rune essence', [{ item: 'blankrune', amount: 19 }]],
    ['Commorb only', [{ item: 'wanted_crystal_ball', amount: 1 }]],
    ['banked-only rune essence', [{ item: 'blankrune', amount: 20, bank: true }]],
    ['pure essence', [{ item: 'blankrune_high', amount: 20 }]],
    ['noted rune essence', [{ item: 'cert_blankrune', amount: 20 }]],
    ['noted pure essence', [{ item: 'cert_blankrune_high', amount: 20 }]],
    ['insufficient mixed forms', [{ item: 'blankrune', amount: 19 }, { item: 'blankrune_high', amount: 1 }]],
];
for (const [label, offer] of invalidOffers) {
    const p = player(8);
    prepareMage(p, 'rcu_zammy_mage1a');
    for (const item of offer) (item.bank ? bank(p) : inventory(p)).add(id('obj', item.item), item.amount);
    const beforeInv = new Map(offer.filter(item => !item.bank).map(item => [item.item, count(p, item.item)]));
    const beforeBank = new Map(offer.filter(item => item.bank).map(item => [item.item, count(p, item.item, bank(p))]));
    talk(p, 'rcu_zammy_mage1a');
    for (const [item, amount] of beforeInv) assert.equal(count(p, item), amount, `${label}: ${item} inventory unchanged`);
    for (const [item, amount] of beforeBank) assert.equal(count(p, item, bank(p)), amount, `${label}: ${item} bank unchanged`);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), 1, `${label}: no paid flag`);
    assert.equal(get(p, 'wanted_main'), 8, `${label}: no stage advance`);
    assert.doesNotMatch(text(p), /moved East of here|Wolf fur/);
}

// STEP 5: only entering the Canifis mapzone at stage 9 starts the lecture; the write follows its final line.
{
    const p = player(9);
    set(p, 'wanted_daquarius_hint', 2);
    set(p, 'wanted_zammy_mage_hint', 2);
    p.level = 0;
    p.x = 3490;
    p.z = 3490;
    const beforeHigh = p.getVar(id('varp', 'quest_wanted')) & ~2047;
    clearText(p);
    const lecture = run(p, '[mapzone,0_54_54]', null);
    assert.equal(lecture.exec, ScriptState.PAUSEBUTTON);
    assert.equal(get(p, 'wanted_main'), 9, 'stage remains 9 during Savant lecture');
    drive(p, lecture);
    assert.equal(get(p, 'wanted_main'), 10, 'stage advances only after lecture completes');
    assert(p.packets.some(packet => packet.constructor.name === 'IfSetColour'), 'stage 10 refreshes progress colour');
    assert.match(text(p), /Use the 'Scan' function of your CommOrb/);
    assert.equal(p.getVar(id('varp', 'quest_wanted')) & ~2047, beforeHigh);
    const transcript = text(p);
    const repeat = run(p, '[mapzone,0_54_54]', null);
    drive(p, repeat);
    assert.equal(get(p, 'wanted_main'), 10);
    assert.equal(text(p), transcript, 'repeat entry does not duplicate the lecture');
}

// STEP 6: pre-Wanted Daquarius and both established Abyss mage branches remain active.
{
    const p = player(7);
    talk(p, 'lord_daquarius');
    assert.equal(text(p), '', 'pre-Wanted Daquarius remains inactive');
    assert.equal(get(p, 'wanted_main'), 7);
}
{
    const p = player(7);
    set(p, 'runemysteries', 6);
    set(p, 'abyssal_miniquest', 0);
    talk(p, 'rcu_zammy_mage1a');
    assert.equal(get(p, 'abyssal_miniquest'), 1, 'Edgeville mage still starts the Abyss miniquest');
    assert.match(text(p), /Meet me in Varrock's Chaos Temple/);
    assert.equal(get(p, 'wanted_main'), 7);
}
{
    const p = player(7);
    set(p, 'runemysteries', 6);
    set(p, 'abyssal_miniquest', 1);
    talk(p, 'rcu_zammy_mage1_edgeb', [4]);
    assert.match(text(p), /Ah, you again/);
    assert.equal(get(p, 'wanted_main'), 7);
}

// Journal follows the authored product stage transitions, while the quest's packed base remains intact.
for (const [stage, phrase] of [
    [8, 'speak to Lord Daquarius'],
    [9, 'I have both intelligence leads'],
    [10, 'Savant explained that I can use my CommOrb to scan for Solus'],
]) {
    const p = player(stage);
    clearText(p);
    drive(p, run(p, '[proc,wanted_journal]'));
    assert.match(text(p).replace(/@[a-z]{3}@/gi, ''), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

console.log('PASS Wanted S4 intelligence, attribution, payment, entry lecture, and regressions');
process.exit(0);
