// Execute the packed production handlers with ScriptRunner and no NPC target.
// Run from the sibling engine: node --import tsx ../content/tests/wanted/savant.mjs
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
assert.notEqual(id('npc', 'wanted_savant'), undefined, 'chat type resolves to the packed Savant identity');
function player() {
    const p = new Player('wanted_savant_test', 0n, 0n);
    p.uid = 1; p.pid = 1; p.lastMovement = 0; p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.packets.push({ text });
    p.wrappedMessageGame = p.messageGame;
    return p;
}
function fixture(stage, contacted = 0, intel = 0, daquariusHint = 0, mageHint = 0) {
    const p = player();
    // Seed every packed bit, then clear only the fields under test.
    set(p, 'quest_wanted', -1);
    set(p, 'quest_wanted2', -1);
    set(p, 'wanted_main', stage);
    set(p, 'wanted_commorb_intel', intel);
    set(p, 'wanted_contacted_savant', contacted);
    set(p, 'wanted_daquarius_hint', daquariusHint);
    set(p, 'wanted_zammy_mage_hint', mageHint);
    return p;
}
function run(p, name) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing ${name}`);
    const state = ScriptRunner.init(script, p, null);
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
const stage = p => get(p, 'wanted_main');
const chatHeadings = new Set(['npcchat', 'chat'].flatMap(prefix =>
    Array.from({ length: 4 }, (_, index) => id('interface', `${prefix}${index + 1}:com_1`))));
const text = p => normalize(p.packets.filter(packet => !chatHeadings.has(packet.component)).map(packet => packet.text ?? '').join(' '));
function menuOptions(p, count) {
    return Array.from({ length: count }, (_, index) => {
        const component = id('interface', `multi${count}:com_${index + 1}`);
        return p.packets.filter(packet => packet.constructor.name === 'IfSetText' && packet.component === component).at(-1)?.text;
    });
}
function checkIncludes(actual, expected, description) {
    for (const fragment of expected) assert(actual.includes(fragment), `${description}: ${fragment}`);
}
const PRESERVE_TRANSFER_MASK = ~((0x7ff) | (1 << 12) | (1 << 13));
const PRESERVE_GREETING_MASK = ~(1 << 13);

// First contact is a separate durable bit. It does not grant assignment intel.
{
    const p = fixture(7);
    const before = get(p, 'quest_wanted') & PRESERVE_GREETING_MASK;
    const r = run(p, '[label,wanted_savant_contact]');
    assert.equal(get(p, 'wanted_contacted_savant'), 0, 'the initial Hello does not complete the greeting');
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
    assert.equal(stage(p), 7);
    assert.equal(get(p, 'quest_wanted') & PRESERVE_GREETING_MASK, before);
    assert.equal(get(p, 'quest_wanted2'), -1);
    const menu = drive(p, r, [], true);
    assert.equal(get(p, 'wanted_contacted_savant'), 1, 'the completed greeting commits before the menu');
    assert.deepEqual(menuOptions(p, 3), ['Current Assignment', 'Savant', 'The Temple Knights']);
    checkIncludes(text(p), ['Hello...?', 'Sir Tiffy told me to expect you to call in on this frequency!', 'Pretty nifty little piece of kit this crystal, huh?'], 'first greeting');
    drive(p, menu, [2]);
    checkIncludes(text(p), [
        'My real name is Elyssa Van Lendes, but for operational purposes I am called Savant.',
        'I am the S.M.R. and Chief Librarian for the Temple Knights.',
        'It stands for Senior Mystical Researcher.',
        'Many of the devices used by the Temple Knights such as our CommOrbs and SpyOrbs were first designed by my team as experimental devices, and have since become standard field equipment!',
        "Let me tell you something, the mages who work there are idiots! They told me that magical research wasn't suitable for 'just a girl' and that I would be 'too scared' to research for them effectively!",
        'Savant over and out.'
    ], 'Savant biography');
    assert.equal(stage(p), 7);
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
}
console.log('PASS first greeting flag is independent of assignment transfer; first menu and Savant biography');
// The first-contact menu's Current Assignment route reaches the same transfer.
{
    const p = fixture(7);
    const contact = run(p, '[label,wanted_savant_contact]');
    const menu = drive(p, contact, [], true);
    assert.deepEqual(menuOptions(p, 3), ['Current Assignment', 'Savant', 'The Temple Knights']);
    drive(p, menu, [1]);
    checkIncludes(text(p), [
        'No, that would take far too long... Listen, I am going to transfer all information on Solus that we currently have to your CommOrb.'
    ], 'first-contact assignment');
    assert.equal(stage(p), 8);
    assert.equal(get(p, 'wanted_commorb_intel'), 1);
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
}

// The Temple Knights option includes the complete retained history record.
{
    const p = fixture(7);
    const menu = drive(p, run(p, '[label,wanted_savant_contact]'), [3]);
    checkIncludes(text(p), [
        'Well, you are not officially a full fledged Temple Knight now, are you Initiate',
        'I am afraid that means for security reasons I can only give you a brief overview of the organisation...',
        "That is usually the case, yes, I agree. Well, let's see if I remember how this goes... 'Legends tell us that Lord Saradomin once walked these lands amongst us, and delivered his wisdom unto us personally, so that we could grow wise in his honour.",
        'But then came the war, that shattered our lands, and the interloper banished our land from us!',
        'Those warriors whose hearts were as pure as their minds were sharp were called to him, and were made into his Temple Knights, for they were the Knights that guarded his very first Temple.',
        'Rather, they were made targets by Saradomins enemies, and driven from the lands unjustly!',
        "Thus it was that they became a secret force, hidden from the eyes of Saradomins enemies, that could strike against evil in his name swiftly and quietly whenever they may be needed.'",
        "Something like that I think, it's been a long time since I heard it last...",
        'Okay, thanks Savant.'
    ], 'Temple Knights history');
    assert.equal(stage(p), 7);
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
    assert.equal(menu.exec, ScriptState.FINISHED);
}
console.log('PASS complete Temple Knights history and non-writer path');

// A returning conversation has four choices. Nothing is a non-writer.
{
    const p = fixture(7, 1, 0);
    const r = run(p, '[label,wanted_savant_contact]');
    const menu = drive(p, r, [], true);
    assert.deepEqual(menuOptions(p, 4), ['Current Assignment', 'Savant', 'The Temple Knights', 'Nothing']);
    checkIncludes(text(p), ['Hello there ', 'What can I help you with?'], 'repeat greeting');
    const before = get(p, 'quest_wanted');
    drive(p, menu, [4]);
    checkIncludes(text(p), [
        'Nothing thanks Savant, I was just checking this thing still worked!',
        "You shouldn't really waste my time like this, ",
        'Still no harm done, I guess! Call me if you need me!',
        'Okay Savant, will do.',
        'Savant out.'
    ], 'Nothing option');
    assert.equal(get(p, 'quest_wanted'), before);
    assert.equal(stage(p), 7);
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
}
console.log('PASS repeat menu includes Nothing and does not mutate quest state');

// Both repeat-menu biography routes remain available and do not transfer intel.
for (const [choice, expected] of [
    [2, 'My real name is Elyssa Van Lendes, but for operational purposes I am called Savant.'],
    [3, 'All who dwelled in his lands knew that the Temple Knights were the honoured, the blessed, the personally chosen warriors of Saradomin, and thus were they given great freedom and authority in all of our Lords lands.']
]) {
    const p = fixture(7, 1, 0);
    const menu = drive(p, run(p, '[label,wanted_savant_contact]'), [], true);
    assert.deepEqual(menuOptions(p, 4), ['Current Assignment', 'Savant', 'The Temple Knights', 'Nothing']);
    drive(p, menu, [choice]);
    assert(text(p).includes(expected), `repeat biography option ${choice}`);
    assert.equal(stage(p), 7);
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
}
console.log('PASS returning biography and history options are non-writers');

// Assignment transfer writes intel and stage 8 together after the transfer line.
// The saved first-contact flag may already be set; it does not gate this transfer.
{
    const p = fixture(7, 1, 0, 2, 2);
    const before = get(p, 'quest_wanted') & PRESERVE_TRANSFER_MASK;
    const contact = run(p, '[label,wanted_savant_contact]');
    const assignmentMenu = drive(p, contact, [], true);
    assert.deepEqual(menuOptions(p, 4), ['Current Assignment', 'Savant', 'The Temple Knights', 'Nothing']);
    assert.equal(stage(p), 7);
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
    p.lastCom = id('interface', 'multi4:com_1');
    assignmentMenu.exec = p.runScript(assignmentMenu.state, true, true);
    assert.notEqual(assignmentMenu.exec, ScriptState.ABORTED);
    assert.equal(assignmentMenu.exec, ScriptState.PAUSEBUTTON);
    assert.equal(stage(p), 7, 'choosing Current Assignment is not the transfer');
    assert.equal(get(p, 'wanted_commorb_intel'), 0, 'initial assignment speech grants no intelligence');
    checkIncludes(text(p), ['Hi Savant! I was wondering if you could give me details on my current assignment?'], 'assignment request');
    assert(!text(p).includes('Fur, East of Varrock'), 'stage 7 transfer must not show the later reminder');
    for (let pauses = 0; !text(p).includes('I am going to transfer all information on Solus'); pauses++) {
        assert(pauses < 40 && assignmentMenu.exec === ScriptState.PAUSEBUTTON);
        assert.equal(stage(p), 7, 'pre-transfer Continue does not advance');
        assert.equal(get(p, 'wanted_commorb_intel'), 0);
        assignmentMenu.exec = p.runScript(assignmentMenu.state, true, true);
        assert.notEqual(assignmentMenu.exec, ScriptState.ABORTED);
    }
    assert.equal(stage(p), 7, 'transfer line is still awaiting Continue');
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
    assignmentMenu.exec = p.runScript(assignmentMenu.state, true, true);
    assert.equal(assignmentMenu.exec, ScriptState.PAUSEBUTTON);
    assert.equal(stage(p), 8, 'transfer commits before the next speech');
    assert.equal(get(p, 'wanted_commorb_intel'), 1, 'transfer commits atomically');
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
    assert.equal(get(p, 'wanted_daquarius_hint'), 2);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), 2);
    checkIncludes(text(p), ['You should be able to find a hint of where to find him by examining it.'], 'after transfer');
    drive(p, assignmentMenu);
    checkIncludes(text(p), [
        'Okaaaaay... Bringing up your current assignment details...',
        "No, that would take far too long... Listen, I am going to transfer all information on Solus that we currently have to your CommOrb.",
        'The Library tells me that we have two visual recordings from SpyOrbs available to you, as well as a standard dossier.',
        'Record one is from a routine monitoring of Lord Daquarius.',
        'This shady fellow is a member of the Zamorakian Magical Institute.',
        'Over and out.'
    ], 'first assignment transfer');
    assert.equal(assignmentMenu.exec, ScriptState.FINISHED);
    assert.equal(stage(p), 8);
    assert.equal(get(p, 'wanted_commorb_intel'), 1);
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
    assert.equal(get(p, 'wanted_daquarius_hint'), 2);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), 2);
    assert.equal(get(p, 'quest_wanted') & PRESERVE_TRANSFER_MASK, before);
    assert.equal(get(p, 'quest_wanted2'), -1);
}
console.log('PASS stage 7 transfer commits intel and stage 8 together, preserving unrelated packed bits');

// Before both exact hint-complete values, Current Assignment repeats the
// initial record-transfer speech instead of the premature Fur reminder.
for (const [daquariusHint, mageHint] of [[0, 0], [2, 1], [1, 2], [3, 2], [2, 3]]) {
    const p = fixture(8, 1, 1, daquariusHint, mageHint);
    const before = get(p, 'quest_wanted');
    const menu = drive(p, run(p, '[label,wanted_savant_contact]'), [1]);
    checkIncludes(text(p), [
        'Hi Savant! I was wondering if you could give me details on my current assignment?',
        'I am going to transfer all information on Solus that we currently have to your CommOrb.',
        'Record one is from a routine monitoring of Lord Daquarius.'
    ], `assignment with hint states ${daquariusHint}/${mageHint}`);
    assert(!text(p).includes('Fur, East of Varrock'), `incomplete hints ${daquariusHint}/${mageHint} cannot show the later reminder`);
    assert.equal(menu.exec, ScriptState.FINISHED);
    assert.equal(stage(p), 8);
    assert.equal(get(p, 'wanted_commorb_intel'), 1);
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
    assert.equal(get(p, 'wanted_daquarius_hint'), daquariusHint);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), mageHint);
    assert.equal(get(p, 'quest_wanted'), before);
}
console.log('PASS assignment repeats transfer speech until both witness hint states equal 2');

// The later clue is available only after both witnesses supplied their hint.
for (const questStage of [8, 9, 10, 11]) {
    const p = fixture(questStage, 1, 1, 2, 2);
    const before = get(p, 'quest_wanted');
    const menu = drive(p, run(p, '[label,wanted_savant_contact]'), [1]);
    checkIncludes(text(p), [
        'Hi Savant. Where am I supposed to look for Solus again?',
        'The clue was that Solus is somewhere where you might find Fur, East of Varrock...'
    ], `complete-hint reminder at stage ${questStage}`);
    assert(!text(p).includes('I am going to transfer all information on Solus'), `complete hints use only the later reminder at stage ${questStage}`);
    assert.equal(menu.exec, ScriptState.FINISHED);
    assert.equal(stage(p), questStage);
    assert.equal(get(p, 'wanted_commorb_intel'), 1);
    assert.equal(get(p, 'wanted_contacted_savant'), 1);
    assert.equal(get(p, 'wanted_daquarius_hint'), 2);
    assert.equal(get(p, 'wanted_zammy_mage_hint'), 2);
    assert.equal(get(p, 'quest_wanted'), before);
}
console.log('PASS stage 8–11 reminders require both exact witness completion states and do not write');

// Explicit stage allowlist excludes pre-assignment and unknown stages.
for (const questStage of [0, 1, 2, 3, 4, 5, 6, 12]) {
    const p = fixture(questStage, 0, 0);
    const before = get(p, 'quest_wanted');
    const r = run(p, '[label,wanted_savant_contact]');
    assert.equal(r.exec, ScriptState.FINISHED, `stage ${questStage} is outside the Savant contact allowlist`);
    assert.equal(get(p, 'quest_wanted'), before);
    assert.equal(get(p, 'quest_wanted2'), -1);
    assert.equal(text(p), '', `stage ${questStage} has no Savant dialogue`);
}
console.log('PASS explicit stage allowlist is 7, 8, 9, 10 and 11 only');

const dossierRecords = [
    {
        choice: 1,
        name: 'Solus Dellagar',
        fields: [
            'CLASSIFIED', '@red@Solus Dellagar@bla@', '@blu@Age:@bla@', 'Unknown.',
            '@blu@Place of Birth:@bla@', 'Unknown.', '@blu@Known aliases:@bla@',
            'Solus Darkheart', 'The Murder-mage', "'Mad Solus'", 'Stealthy Pete',
            '@blu@Known affiliates:@bla@',
            'Solus Dellagar has shown time and time again that he considers others to be mere pawns in his schemes, and will discard them at the first viable opportunity.',
            'Despite having been associated with many criminal and undesirable elements known to us, these will not be listed as affiliates, because as a general rule, if you have worked with Solus once you are unlikely to ever do so again.',
            'The only loyalty he has ever managed to inspire in others is through threat of force, and he is indeed powerful, but the general hatred of him amongst those he has encountered means that an experienced field operative will find opportunities to turn associates against him.',
            '@blu@Known History:@bla@',
            "Solus' exact history is still unknown to us, but we suspect he originated in or close to the city of Ardougne.",
            'He was first brought to our attention as a possible threat in the infamous zombie attack of Varrock masterminded by the Mahjarrat Lucien, but did not serve a particularly key role.',
            'Reports of his whereabouts after that are somewhat sketchy, but he seems to have trained a quite formidable magical aptitude in the decades immediately following.',
            'Although he has kept a low profile from conventional authorities, he has made quite a name for himself amongst various underworld circles, especially amongst Zamorakians, where his particularly brutal methods have been cause for some concern.',
            "He earned the nickname 'Murder-mage' and 'Mad Solus' in the incident at Edgeville where he was eventually apprehended by one of our field teams, but not before the wilful slaughter of over 800 civilians, as well as an equal number of White and Black Knights - we are still unsure as to why Lord Daquarius allowed his men to be involved in this affair, because it was distinctly against his usual methods, and this is the only report on file of him making an action under someone else's direct command.",
            "Solus' reputation as an evil, bloodthirsty, greedy and dangerous individual is well deserved, and field operatives should avoid direct confrontation at all costs.",
            'Standard observation rules apply, and if you find yourself in a position where confrontation seems likely, then guidelines suggest you immediately contact your handler who will provide you ample backup - your chances of surviving a one on one assault are slim to none.',
            'End of Report.'
        ]
    },
    {
        choice: 2,
        name: 'Lord Daquarius',
        fields: [
            'CLASSIFIED', '@red@Lord Daquarius@bla@', '@blu@Age:@bla@', '34.',
            '@blu@Place of Birth:@bla@', 'Falador.', '@blu@Known aliases:@bla@',
            'Lord of the Kinshra', 'Daquarius Rennard', '@blu@Known affiliates:@bla@',
            'Leader of the Kinshra, commonly known as the Black Knights.',
            'Has occasional ties to various other Zamorakian agencies.',
            'Has been linked with the Witch Lensig and her familiar Greebo most recently.',
            'Has a number of jail guards in his employ deep in the Taverley dungeon, where enemies of the Kinshra are often imprisoned.',
            '@blu@Known History:@bla@',
            'The charismatic Lord Daquarius was the youngest Black Knight to ever take lead of the Kinshra, being unanimously voted into leadership after the death of Lord Shadwell in the infamous incident at Edgeville.',
            'As leader of the Kinshra, he has been a high priority threat to the White Knights, and his activities with the Black Knights have been a constant thorn in both the side of the White Knights and of the Temple Knights.',
            'However, while the White Knights still actively seek his capture and execution for crimes against the state, the Temple Knights have taken a more reactive position of observation.',
            "Those of us who survived the Edgeville incident and recall what the Black Knight's activities under Lord Shadwell were like, can see that Lord Daquarius is better to keep around than risk another fanatical extremist taking his place.",
            'For all of his misguided belief in Zamorak, Daquarius is an undeniably noble man; we have numerous reports of him risking personal injury so that he may save a fellow Kinshra from harm or death.',
            'His belief in his men as more than simply subjects to be used in war against the White Knights makes him a predictable and easily manipulated enemy that is worth keeping in place, and also accounts for the high regard in which he is held by the rest of the Kinshra.',
            'End of Report.'
        ]
    },
    {
        choice: 3,
        name: 'Zamorakian research mage',
        fields: [
            'CLASSIFIED', '@red@Name Unknown@bla@', '@blu@Age:@bla@', 'Unknown.',
            '@blu@Place of Birth:@bla@', 'Unknown.', '@blu@Known aliases:@bla@', 'Unknown',
            '@blu@Known affiliates:@bla@',
            'The Zamorakian Magical Institute, a research group that we have classified as fairly innocuous that primarily focuses on magical research dedicated to assisting Zamorak.',
            'Observation suggests that the Z.M.I. is the same faction of Zamorakians that burnt down the Wizards Tower in Operation: Phoenix, but firm conclusions as to the reason for this remain at best sketchy and unsupported by evidence.',
            'It is certainly worthwhile to keep any known members of the Z.M.I. under observation, however.',
            '@blu@Known History:@bla@',
            'Recently this unidentified mage has begun to base his activities in and around the area of Varrock, specifically the Temple to Zamorak that was foolishly allowed to be built there.',
            'We have some evidence that this Mage also works as a rune-dealer in the vicinity of Edgeville, but preventing his operations in the Wilderness is far beyond our jurisdiction, and any actions taken there would bring unwanted attention to our own order by various entities.',
            'We have installed standard observation devices in the Zamorakian temple, but his activities have apparently been limited to a small degree of smuggling and the purchasing and resale of various pieces of contraband.',
            'Although no obvious threat from his presence has been detected, we will continue standard observation in case he turns out to be a bigger fish than he at first glance seems.',
            'End of Report.'
        ]
    }
];
function journalLines(p) {
    const components = [4, ...Array.from({ length: 99 }, (_, index) => index + 6)];
    return components.map(number => {
        const component = id('interface', `questjournal:com_${number}`);
        return p.packets.filter(packet => packet.constructor.name === 'IfSetText' && packet.component === component).at(-1)?.text;
    }).filter(value => value !== undefined && value !== '');
}
function normalize(value) { return value.replace(/\s+/g, ' ').trim(); }
assert(types.Component.get(id('interface', 'questjournal:com_2')).scroll > 0, 'existing quest journal body is scrollable');
for (const dossier of dossierRecords) {
    const p = fixture(0);
    const menu = drive(p, run(p, '[label,wanted_dossiers]'), [], true);
    assert.deepEqual(menuOptions(p, 4), ['Solus Dellagar', 'Lord Daquarius', 'Zamorakian research mage', 'Cancel']);
    drive(p, menu, [dossier.choice]);
    assert.equal(p.modalMain, id('interface', 'questjournal'), 'dossier opens the existing journal UI');
    assert.equal(p.refreshModal, true, 'the normal world tick will transmit the opened modal');
    const title = p.packets.filter(packet => packet.constructor.name === 'IfSetText' && packet.component === id('interface', 'questjournal:com_3')).at(-1)?.text;
    assert.equal(title, '@dre@CommOrb Dossier');
    const lines = journalLines(p);
    // The font splitter carries black onto each wrapped row. Compare the text
    // without those redundant resets, then check every authored colour row.
    assert.equal(normalize(lines.join(' ').replace(/@bla@/g, '')), normalize(dossier.fields.join(' ').replace(/@bla@/g, '')), `${dossier.name}: exact D5 record text and highlight colours`);
    for (const field of dossier.fields.filter(field => field.includes('@'))) {
        assert(lines.some(line => line.replace(/^@bla@/, '') === field), `${dossier.name}: exact colour row ${field}`);
    }
    for (const alias of dossier.name === 'Solus Dellagar' ? ['Solus Darkheart', 'The Murder-mage', "'Mad Solus'", 'Stealthy Pete'] : dossier.name === 'Lord Daquarius' ? ['Lord of the Kinshra', 'Daquarius Rennard'] : ['Unknown']) {
        assert(lines.some(line => line.replace(/^@bla@/, '') === alias), `${dossier.name}: alias row ${alias}`);
    }
    assert.equal(stage(p), 0, `${dossier.name}: dossier display does not gate on quest stage`);
    assert.equal(get(p, 'wanted_contacted_savant'), 0);
    assert.equal(get(p, 'wanted_commorb_intel'), 0);
}
console.log('PASS all three exact D5 dossiers use the independently selectable, scrollable quest-journal UI');

// Cancel is available without a castle, Playback path, or quest-state mutation.
{
    const p = fixture(7, 0, 0);
    const before = get(p, 'quest_wanted');
    const menu = drive(p, run(p, '[label,wanted_dossiers]'), [4]);
    assert.equal(menu.exec, ScriptState.FINISHED);
    assert.equal(get(p, 'quest_wanted'), before);
    assert.equal(get(p, 'quest_wanted2'), -1);
    assert.notEqual(p.modalMain, id('interface', 'questjournal'));
}
console.log('PASS dossier selector cancel is a non-writer');
console.log('RESULT PASS Wanted Savant production handlers and D5 dossier UI');
process.exit(0);
