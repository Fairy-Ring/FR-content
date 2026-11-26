// Packed production coverage for the Wanted! closeout, chase, rewards and armoury.
// Run from the sibling engine: NODE_XPRATE=1 node --import tsx ../content/tests/wanted/test_wanted_closeout.mjs
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
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const { ScriptOpcodeMap } = await import(pathToFileURL(path.join(engine, 'src/engine/script/ScriptOpcode.ts')).href);
const Environment = await load('src/util/Environment.ts');
const route = await load('src/engine/routefinder/index.ts');
assert.equal(Environment.NODE_XPRATE, 1, 'completion XP is measured without a rate multiplier');

const types = {};
for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'ParamType', 'LocType', 'SeqType',
    'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType'
]) {
    types[name] = await load(`src/cache/config/${name}.ts`);
    types[name].load(pack);
}
const DbTableIndex = await load('src/cache/config/DbTableIndex.ts');
DbTableIndex.init();
assert(ScriptProvider.load(pack) > 0, 'packed production scripts load');
World.currentTick = 1;
// The isolated fixture allocates the rescue zone so ordinary teleport validation runs.
route.allocateIfAbsent(2985, 3345, 0);

const maps = new Map();
function entries(kind) {
    if (!maps.has(kind)) {
        const source = fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8');
        maps.set(kind, new Map([...source.matchAll(/^(\d+)=(.+)$/gm)].map(match => [match[2].trim(), Number(match[1])])));
    }
    return maps.get(kind);
}
function id(kind, name) {
    const value = entries(kind).get(name);
    assert.notEqual(value, undefined, `${kind}:${name}`);
    return value;
}
function set(p, name, value) {
    const bit = entries('varbit').get(name);
    if (bit !== undefined) p.setVarBit(bit, value);
    else p.setVar(id('varp', name), value);
}
function get(p, name) {
    const bit = entries('varbit').get(name);
    return bit !== undefined ? p.getVarBit(bit) : p.getVar(id('varp', name));
}
const home = [0, 2997, 3373];
const missionCoords = {
    1: [0, 54, 54, 48, 30], 2: [1, 38, 54, 33, 39], 3: [0, 49, 52, 55, 34],
    4: [0, 39, 48, 53, 21], 5: [0, 45, 49, 33, 29], 6: [0, 43, 49, 44, 19],
    7: [0, 38, 50, 7, 25], 8: [0, 38, 48, 10, 18], 9: [0, 50, 149, 20, 24],
    10: [0, 46, 54, 11, 49], 11: [0, 51, 150, 37, 5], 12: [0, 51, 50, 36, 11],
    13: [0, 40, 57, 60, 22], 14: [0, 41, 51, 38, 39], 15: [0, 41, 54, 29, 24],
    16: [0, 48, 49, 36, 26], 17: [0, 53, 55, 31, 30], 18: [0, 48, 50, 9, 52],
    19: [0, 45, 75, 32, 33]
};
function tile(mission) {
    const [level, regionX, regionZ, localX, localZ] = missionCoords[mission];
    return [level, regionX * 64 + localX, regionZ * 64 + localZ];
}
let playerSerial = 0;
let npcSerial = 0;
function player(stage = 9, position = home) {
    const serial = ++playerSerial;
    const p = new Player(`wanted_closeout_${serial}`, BigInt(serial), BigInt(0x100000 + serial));
    p.slot = serial;
    p.uid = (Number(p.username37 & 0x1fffffn) << 11) | serial;
    p.pid = serial;
    p.isActive = true;
    p.level = position[0]; p.x = position[1]; p.z = position[2];
    p.lastMovement = 0;
    p.levels.fill(99);
    p.baseLevels.fill(99);
    p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.packets.push({ text });
    p.wrappedMessageGame = p.messageGame;
    set(p, 'quest_wanted', -2048);
    set(p, 'quest_wanted2', -1);
    set(p, 'wanted_main', stage);
    set(p, 'wanted_contacted_savant', 1);
    set(p, 'wanted_commorb_intel', 1);
    set(p, 'wanted_daquarius_hint', 0);
    set(p, 'wanted_zammy_mage_hint', 0);
    set(p, 'rd_main', 0);
    set(p, 'spy', 0);
    for (let mission = 1; mission <= 19; mission++) {
        set(p, `wanted_mission${mission}`, 0);
        set(p, `wanted_mission${mission}complete`, 0);
    }
    World.players[serial] = p;
    World.playerLoop.add(p.hash64, p);
    World.gameMap.getZone(p.x, p.z, p.level).enter(p);
    return p;
}
function npc(name, position = home) {
    const type = id('npc', name);
    return new Npc(position[0], position[1], position[2], 1, 1, EntityLifeCycle.RESPAWN,
        ++npcSerial, type, types.NpcType.get(type).blockwalk);
}
function run(p, name, target = npc('rd_teleporter_guy')) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing packed ${name}`);
    const state = ScriptRunner.init(script, p, target);
    const result = { state, target, exec: p.runScript(state, true, true) };
    assert.notEqual(result.exec, ScriptState.ABORTED, name);
    return result;
}
function drive(p, result, choices = []) {
    const remaining = [...choices];
    let steps = 0;
    while (result.exec !== ScriptState.FINISHED) {
        assert(steps++ < 600, `script did not finish: ${result.state.script.name}`);
        if (result.exec === ScriptState.NPC_SUSPENDED) {
            assert(result.target, 'NPC dialogue continuation has a target');
            result.target.executeScript(result.state);
            result.exec = result.state.execution;
        } else if (result.exec === ScriptState.SUSPENDED) {
            World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil ?? 0);
            p.delayed = false;
            p.executeScript(result.state, true, true);
            result.exec = result.state.execution;
        } else if (result.exec === ScriptState.PAUSEBUTTON) {
            const menu = result.state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
            if (menu) {
                assert(remaining.length > 0, `unanswered ${result.state.script.name}`);
                p.lastCom = id('interface', `multi${menu[1]}:com_${remaining.shift()}`);
            }
            World.currentTick++;
            p.executeScript(result.state, true, true);
            result.exec = result.state.execution;
        } else {
            assert.fail(`unexpected script execution ${result.exec}: ${result.state.script.name}`);
        }
        assert.notEqual(result.exec, ScriptState.ABORTED, result.state.script.name);
    }
    assert.deepEqual(remaining, [], 'all supplied dialogue choices were consumed');
    return result;
}
function talk(p, who, choices = []) {
    return drive(p, run(p, `[opnpc1,${who}]`, npc(who, [p.level, p.x, p.z])), choices);
}
function procInt(p, name) {
    const result = drive(p, run(p, name));
    assert.equal(result.state.isp, 1, `${name} returns one integer`);
    return result.state.popInt();
}
const inventory = p => p.getInventory(id('inv', 'inv'));
const bank = p => p.getInventory(id('inv', 'bank'));
const count = (p, item, which = inventory(p)) => which.getItemCount(id('obj', item));
const text = p => p.packets.map(packet => packet.text ?? '').join(' ').replace(/\s+/g, ' ');
const clearText = p => { p.packets.length = 0; };
function resetChase(p) {
    for (let mission = 1; mission <= 19; mission++) {
        set(p, `wanted_mission${mission}`, 0);
        set(p, `wanted_mission${mission}complete`, 0);
    }
}
function fieldPlayer(position = tile(1)) {
    const p = player(9, position);
    resetChase(p);
    inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    return p;
}
function activeMission(p) {
    const active = [];
    for (let mission = 1; mission <= 19; mission++) {
        if (get(p, `wanted_mission${mission}`) === 1) active.push(mission);
    }
    assert(active.length <= 1, `only one active mission bit: ${active.join(',')}`);
    return active[0] ?? 1;
}
const randomOpcode = ScriptOpcodeMap.get('RANDOM');
assert.notEqual(randomOpcode, undefined, 'RuneScript RANDOM opcode is available');
const originalRandom = ScriptRunner.HANDLERS[randomOpcode];
function withRandom(fractions, action) {
    let index = 0;
    ScriptRunner.HANDLERS[randomOpcode] = state => {
        const bound = state.popInt();
        assert(index < fractions.length, `unexpected random(${bound})`);
        const result = Math.floor(fractions[index++] * bound);
        assert(result >= 0 && result < bound, `random(${bound}) fixture is in range`);
        state.pushInt(result);
    };
    try {
        const result = action();
        assert.equal(index, fractions.length, 'every controlled random result was consumed');
        return result;
    } finally {
        ScriptRunner.HANDLERS[randomOpcode] = originalRandom;
    }
}
const chooseMission = mission => (mission - 2 + 0.25) / 17;
function scan(p, randoms = []) {
    return withRandom(randoms, () => drive(p, run(p, '[opheld1,wanted_crystal_ball]')));
}
function fillFull(p, keep = []) {
    const inv = inventory(p);
    const filler = id('obj', 'bronze_sword');
    for (let slot = 0; slot < inv.capacity; slot++) inv.set(slot, { id: filler, count: 1 });
    for (const item of keep) {
        inv.remove(filler, 1);
        inv.add(id('obj', item), 1);
    }
}
function ownedActors(p, typeName) {
    const type = id('npc', typeName);
    const owner = id('varn', 'npc_attacking_uid');
    return [...World.npcs].filter(actor => actor.isActive && actor.type === type && (actor.getVar(owner) >>> 0) === p.uid);
}
function attributedDeath(p, trigger, target, hero = p, randoms = []) {
    p.closeModal(false);
    target.heroPoints.addHero(hero.hash64, 10);
    target.setVar(id('varn', 'npc_aggressive_player'), hero.uid);
    return withRandom(randoms, () => {
        const result = drive(p, run(p, `[ai_queue3,${trigger}]`, target));
        p.processQueues();
        if (p.activeScript) drive(p, { state: p.activeScript, target: null, exec: p.activeScript.execution });
        return result;
    });
}

// The stage-8 Canifis entry is the real S4-to-chase writer; no mission bit is pre-seeded.
{
    const p = player(8, tile(1));
    set(p, 'wanted_daquarius_hint', 2);
    set(p, 'wanted_zammy_mage_hint', 2);
    inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
    drive(p, run(p, '[proc,wanted_canifis_entry]'));
    assert.equal(get(p, 'wanted_main'), 9, 'Canifis entry commits the chase stage');
    assert.equal(activeMission(p), 1, 'no active mission bits means the initial Canifis target');
    scan(p, [chooseMission(2)]);
    assert.equal(get(p, 'wanted_main'), 9);
    assert.equal(get(p, 'wanted_mission1complete'), 1, 'the first Canifis scan is accepted');
    assert.equal(activeMission(p), 2);
    assert.equal(count(p, 'gnome_hat_cream'), 1, 'the first scan supplies the next clue');
}

// Range/full-inventory refusals leave the initial mission and inventory unchanged.
{
    const wrong = fieldPlayer(home);
    scan(wrong);
    assert.equal(get(wrong, 'wanted_mission1complete'), 0);
    assert.equal(activeMission(wrong), 1);
    assert.equal(count(wrong, 'gnome_hat_cream'), 0);
    assert.match(text(wrong), /Scan results are negative/i);

    const full = fieldPlayer(tile(1));
    fillFull(full, ['wanted_crystal_ball']);
    scan(full);
    assert.equal(get(full, 'wanted_mission1complete'), 0);
    assert.equal(activeMission(full), 1);
    assert.match(text(full), /one free inventory space/i);
}

// Every randomized field destination returns its own clue; Ardougne covers both source items.
const expectedClues = new Map([
    [2, 'gnome_hat_cream'], [3, 'blue_cape'], [4, 'greenmans_ale'], [5, 'banana'],
    [6, 'eye_patch'], [7, 'blessedsnake'], [8, 'castlewars_ticket'], [9, 'giant_frog_legs'],
    [10, 'goblin_armour'], [11, 'cave_goblin_bone_spear'], [12, 'feud_karidian_fakebeard'],
    [13, 'viking_cloak_grey'], [15, 'red_vine_worm'], [16, 'bluewizhat'],
    [17, 'slayer_earmuffs'], [18, 'horsey_grey']
]);
const hintFragments = new Map([
    [2, 'hat?'], [3, 'cape'], [4, 'beer?'], [5, 'banana?'], [6, 'eye patch?'], [7, 'unholy symbol!'],
    [8, 'ticket?'], [9, 'frog legs?'], [10, 'goblin armour?'], [12, 'fake beard?'],
    [13, 'cloak?'], [15, 'worm?'], [16, 'wizard hat?'], [17, 'ear muffs?'], [18, 'toy horse?']
]);
for (const [mission, clue] of expectedClues) {
    const p = fieldPlayer();
    scan(p, [chooseMission(mission)]);
    assert.equal(activeMission(p), mission, `random destination ${mission}`);
    assert.equal(get(p, 'wanted_mission1complete'), 1);
    assert.equal(count(p, clue), 1, `mission ${mission} clue`);
    if (hintFragments.has(mission)) assert(text(p).includes(hintFragments.get(mission)), `mission ${mission} retained item hint`);
    if (mission !== 11) {
        const next = mission === 2 ? 3 : 2;
        [p.level, p.x, p.z] = tile(mission);
        scan(p, [chooseMission(next)]);
        assert.equal(get(p, `wanted_mission${mission}complete`), 1, `scan at mission ${mission} location is accepted`);
        assert.equal(activeMission(p), next, `mission ${mission} advances after an in-range scan`);
    }
}
for (const [fraction, clue] of [[0.25, 'cake'], [0.75, 'fur']]) {
    const p = fieldPlayer();
    scan(p, [chooseMission(14), fraction]);
    assert.equal(activeMission(p), 14);
    assert.equal(count(p, clue), 1, `Ardougne random clue ${clue}`);
    assert.equal(count(p, clue === 'cake' ? 'fur' : 'cake'), 0);
    if (clue === 'fur') assert(text(p).includes('fur?'), 'fur has its retained Savant hint');
    else assert(!text(p).includes('fur?'), 'cake does not claim the fur hint');
}
{
    const p = fieldPlayer();
    set(p, 'wanted_mission2complete', 1);
    scan(p, [0]);
    assert.equal(get(p, 'wanted_mission2complete'), 1, 'completed destination remains recorded');
    assert.equal(activeMission(p), 3, 'random duplicate is advanced to the next unfinished mission');
    assert.equal(count(p, 'blue_cape'), 1);
}

// Main chase: two ordinary appearances, the third-scan rescue, then attributed fifth-scan knight.
const p = player(8, tile(1));
set(p, 'wanted_daquarius_hint', 2);
set(p, 'wanted_zammy_mage_hint', 2);
set(p, 'rd_main', 2);
set(p, 'spy', 4);
inventory(p).add(id('obj', 'wanted_crystal_ball'), 1);
drive(p, run(p, '[proc,wanted_canifis_entry]'));
scan(p, [chooseMission(2)]);
p.level = tile(2)[0]; p.x = tile(2)[1]; p.z = tile(2)[2];
scan(p, [chooseMission(3)]);
assert.equal(get(p, 'wanted_mission2complete'), 1);
assert.equal(activeMission(p), 3);
p.level = tile(3)[0]; p.x = tile(3)[1]; p.z = tile(3)[2];
scan(p, [chooseMission(4)]);
assert.equal(get(p, 'wanted_mission3complete'), 1, 'third scan completes after Solus flames');
assert.equal(activeMission(p), 4);
assert.deepEqual([p.level, p.x, p.z], [0, 2985, 3345], 'Savant returns the player to Falador');
p.level = tile(4)[0]; p.x = tile(4)[1]; p.z = tile(4)[2];
scan(p, [chooseMission(5)]);
assert.equal(get(p, 'wanted_mission4complete'), 1);
assert.equal(activeMission(p), 5);
p.level = tile(5)[0]; p.x = tile(5)[1]; p.z = tile(5)[2];
scan(p);
assert.equal(get(p, 'wanted_mission5complete'), 0, 'the fifth scan waits for the summoned knight');
assert.equal(ownedActors(p, 'wanted_summoned_black_knight').length, 1);
let knight = ownedActors(p, 'wanted_summoned_black_knight')[0];
const other = player(9, tile(5));
attributedDeath(p, 'wanted_summoned_black_knight', knight, other);
assert.equal(get(p, 'wanted_mission5complete'), 0, 'another hero cannot credit the owner-bound knight');
assert.equal(activeMission(p), 5);
assert.equal(ownedActors(p, 'wanted_summoned_black_knight').length, 0, 'the uncredited actor is removed');
scan(p);
knight = ownedActors(p, 'wanted_summoned_black_knight')[0];
assert(knight, 'the same scan can retry the owner-bound knight encounter');
attributedDeath(p, 'wanted_summoned_black_knight', knight);
assert.equal(get(p, 'wanted_mission5complete'), 1);
assert.equal(activeMission(p), 19, 'five completed field scans select the essence mine');
assert.equal(count(p, 'blankrune'), 1, 'credited knight death supplies the final clue');

// The Dorgeshuun disguise is owner-bound, inventory-gated and completes only on Talk-to.
{
    const woman = fieldPlayer(tile(11));
    set(woman, 'wanted_mission11', 1);
    scan(woman);
    assert.equal(get(woman, 'wanted_mission11complete'), 0);
    const actor = ownedActors(woman, 'wanted_solus_fake_woman_base_config')[0];
    assert(actor, 'mission 11 spawns the fake woman');
    const wrongOwner = player(9, tile(11));
    actor.setVar(id('varn', 'npc_attacking_uid'), wrongOwner.uid);
    drive(woman, run(woman, '[opnpc1,wanted_solus_fake_woman_base_config]', actor));
    assert.equal(get(woman, 'wanted_mission11complete'), 0, 'another player cannot resolve the fake woman');
    actor.setVar(id('varn', 'npc_attacking_uid'), woman.uid);
    fillFull(woman, ['wanted_crystal_ball']);
    drive(woman, run(woman, '[opnpc1,wanted_solus_fake_woman_base_config]', actor));
    assert.equal(get(woman, 'wanted_mission11complete'), 0, 'full inventory preserves the retry');
    inventory(woman).remove(id('obj', 'bronze_sword'), 1);
    withRandom([chooseMission(12)], () => drive(woman, run(woman, '[opnpc1,wanted_solus_fake_woman_base_config]', actor)));
    assert.equal(get(woman, 'wanted_mission11complete'), 1);
    assert.equal(activeMission(woman), 12);
    assert.equal(count(woman, 'feud_karidian_fakebeard'), 1);
}

// Mine confrontation has one owner-bound final target; only its attributed death ends the chase.
p.level = tile(19)[0]; p.x = tile(19)[1]; p.z = tile(19)[2];
scan(p);
assert.equal(get(p, 'wanted_main'), 9);
assert.equal(ownedActors(p, 'wanted_solus_attackable').length, 1);
let solus = ownedActors(p, 'wanted_solus_attackable')[0];
attributedDeath(p, 'wanted_solus_attackable', solus, other);
assert.equal(get(p, 'wanted_main'), 9, 'unattributed Solus death leaves the chase open');
assert.equal(count(p, 'wanted_solus_trophy'), 0);
assert.equal(ownedActors(p, 'wanted_solus_attackable').length, 0);
scan(p);
solus = ownedActors(p, 'wanted_solus_attackable')[0];
assert(solus, 'the mine confrontation can be retried');
attributedDeath(p, 'wanted_solus_attackable', solus);
assert.equal(get(p, 'wanted_main'), 10, 'attributed final death writes the proof stage');
assert.equal(get(p, 'wanted_mission19complete'), 1);
assert.equal(count(p, 'wanted_solus_trophy'), 1);

// Tiffy still routes through Recruitment Drive into Wanted; Savant recovery respects held/banked items and space.
inventory(p).remove(id('obj', 'wanted_crystal_ball'), 1);
p.closeModal(false); clearText(p);
talk(p, 'rd_teleporter_guy', [1]);
assert.equal(get(p, 'wanted_main'), 10);
assert.equal(count(p, 'wanted_crystal_ball'), 1, 'post-quest Tiffy replaces a genuinely missing CommOrb');
function assignment(p) {
    p.closeModal(false); clearText(p);
    return drive(p, run(p, '[opheld2,wanted_crystal_ball]'), [1]);
}
assignment(p);
assert.equal(count(p, 'wanted_solus_trophy'), 1, 'held proof blocks duplicate Savant recovery');
bank(p).add(id('obj', 'wanted_solus_trophy'), 1);
inventory(p).remove(id('obj', 'wanted_solus_trophy'), 1);
assignment(p);
assert.equal(count(p, 'wanted_solus_trophy'), 0);
assert.equal(count(p, 'wanted_solus_trophy', bank(p)), 1, 'banked proof blocks duplicate recovery');

// Sir Amik's real NPC route refuses banked and missing proof without writing completion or rewards.
talk(p, 'sir_amik_varze');
assert.equal(get(p, 'wanted_main'), 10);
assert.equal(count(p, 'wanted_solus_trophy', bank(p)), 1);
bank(p).remove(id('obj', 'wanted_solus_trophy'), 1);
talk(p, 'sir_amik_varze');
assert.equal(get(p, 'wanted_main'), 10, 'missing proof cannot promote');
assert.equal(count(p, 'wanted_solus_trophy'), 0);

fillFull(p, ['wanted_crystal_ball']);
assignment(p);
assert.equal(count(p, 'wanted_solus_trophy'), 0, 'full inventory cannot receive the duplicate hat');
inventory(p).remove(id('obj', 'bronze_sword'), 1);
assignment(p);
assert.equal(count(p, 'wanted_solus_trophy'), 1, 'Savant reissues one missing hat when space is available');
assignment(p);
assert.equal(count(p, 'wanted_solus_trophy'), 1, 'repeat recovery does not duplicate the held hat');

// The authenticated held hat completes once, awards one point and 5,000 Slayer XP, and is consumed.
set(p, 'wanted_white_knight_kills', 500);
const qp = id('varp', 'qp');
const beforeQp = procInt(p, '[proc,count_questpoints]');
p.setVar(qp, beforeQp);
const beforeSlayer = p.stats[PlayerStat.SLAYER];
talk(p, 'sir_amik_varze');
assert.equal(get(p, 'wanted_main'), 11);
assert.equal(count(p, 'wanted_solus_trophy'), 0);
assert.equal(get(p, 'wanted_white_knight_kills'), 0, 'completion begins at Novice reputation');
assert.equal(p.getVar(qp), beforeQp + 1);
assert.equal(procInt(p, '[proc,count_questpoints]'), beforeQp + 1);
assert.equal(p.stats[PlayerStat.SLAYER] - beforeSlayer, 50000, '5,000 Slayer XP in tenths at rate 1');
const scroll = id('interface', 'questscroll_death:com_3');
assert.equal(p.modalMain, types.Component.get(scroll).rootLayer, 'completion scroll opens');
assert.match(p.packets.filter(packet => packet.component === scroll).map(packet => packet.text ?? '').join(' '), /Wanted!/);
p.closeModal(false); clearText(p);
talk(p, 'sir_amik_varze');
assert.equal(get(p, 'wanted_main'), 11);
assert.equal(p.getVar(qp), beforeQp + 1, 'repeat Amik talk awards no extra point');
assert.equal(p.stats[PlayerStat.SLAYER] - beforeSlayer, 50000, 'repeat Amik talk awards no extra XP');

inventory(p).remove(id('obj', 'wanted_crystal_ball'), 1);
p.closeModal(false); clearText(p);
talk(p, 'rd_teleporter_guy', [1]);
assert.equal(get(p, 'wanted_main'), 11);
assert.equal(count(p, 'wanted_crystal_ball'), 1, 'Tiffy remains reachable after Wanted completion');

// The existing Recruitment Drive Tiffy hook gives Devious Minds its report before Wanted's menu.
{
    const tiffy = player(11);
    set(tiffy, 'rd_main', 2);
    set(tiffy, 'devious_main', 50);
    talk(tiffy, 'rd_teleporter_guy', [1]);
    assert.notEqual(get(tiffy, 'devious_main'), 50, 'Devious Minds report branch remains live');
    assert.equal(get(tiffy, 'wanted_main'), 11, 'Devious Minds report does not rewrite Wanted');
    tiffy.closeModal(false); clearText(tiffy);
    talk(tiffy, 'rd_teleporter_guy', [5]);
    assert.match(text(tiffy), /training grounds thingy/i, 'post-debrief Tiffy still reaches the Wanted menu');
    assert.equal(get(tiffy, 'wanted_main'), 11);
}

// White Knight rank boundaries select cumulative stock and exclude every later tier.
const tiers = [
    ['wanted_armoury_novice', ['white_chainbody', 'white_platelegs'], 1],
    ['wanted_armoury_peon', ['white_dagger', 'white_sword'], 1],
    ['wanted_armoury_page', ['white_plateskirt', 'white_med_helm', 'white_sq_shield'], 1],
    ['wanted_armoury_noble', ['white_mace', 'white_magic_staff', 'white_longsword'], 1],
    ['wanted_armoury_adept', ['white_full_helm', 'white_kiteshield', 'white_platebody', 'white_armoured_boots', 'white_gloves'], 20],
    ['wanted_armoury_master', ['white_warhammer', 'white_battleaxe', 'white_scimitar', 'white_claws', 'white_2h_sword', 'white_halberd'], 20]
];
const boundaries = [[0, 0], [99, 0], [100, 1], [199, 1], [200, 2], [399, 2], [400, 3], [799, 3], [800, 4], [1599, 4], [1600, 5]];
for (const [kills, rank] of boundaries) {
    const p = player(11);
    set(p, 'wanted_white_knight_kills', kills);
    assert.equal(procInt(p, '[proc,wanted_armoury_rank]'), rank, `${kills} kills -> rank ${rank}`);
    talk(p, 'sir_vyvin', [1]);
    const [shopName] = tiers[rank];
    const shopId = id('inv', shopName);
    assert.equal(p.getVar(id('varp', 'shop')), shopId, `${kills} kills opens the expected tier`);
    assert.equal(p.modalMain, types.Component.get(id('interface', 'shop_template')).rootLayer);
    const config = types.InvType.get(shopId);
    const expected = tiers.slice(0, rank + 1).flatMap(([, items]) => items);
    const later = tiers.slice(rank + 1).flatMap(([, items]) => items);
    assert.deepEqual(Array.from(config.stockobj), expected.map(item => id('obj', item)), 'stock is cumulative and exact');
    const listener = p.invListeners.find(entry => entry.type === shopId && entry.com === id('interface', 'shop_template:inv'));
    assert(listener, 'real shop stock inventory is transmitted');
    const stock = p.getInventoryFromListener(listener);
    const expectedCount = expected.map(item => id('obj', item));
    for (let index = 0; index < expected.length; index++) {
        const expectedQty = rank >= 4 ? 20 : 1;
        assert.equal(config.stockcount[index], expectedQty, `${expected[index]} configured quantity`);
        assert.equal(stock.getItemCount(expectedCount[index]), expectedQty, `${expected[index]} actual shop stock`);
    }
    for (const item of later) assert.equal(stock.getItemCount(id('obj', item)), 0, `${item} is not available before its rank`);
}
{
    const p = player(10);
    set(p, 'wanted_white_knight_kills', 1600);
    talk(p, 'sir_vyvin', [1]);
    assert.notEqual(p.modalMain, types.Component.get(id('interface', 'shop_template')).rootLayer,
        'Solus-defeated stage cannot open the White Knight armoury');
}

// Ordinary post-completion death hooks record only attributed kills; White Knight loss floors at Novice.
{
    const p = player(11);
    set(p, 'wanted_white_knight_kills', 99);
    const uncredited = npc('black_knight');
    withRandom([], () => drive(p, run(p, '[ai_queue3,black_knight]', uncredited)));
    assert.equal(get(p, 'wanted_white_knight_kills'), 99, 'uncredited Black Knight death is ignored');
    const blackKnight = npc('black_knight');
    attributedDeath(p, 'black_knight', blackKnight, p, [0]);
    assert.equal(get(p, 'wanted_white_knight_kills'), 100, 'attributed Black Knight kill raises reputation');
    const whiteKnight = npc('white_knight');
    attributedDeath(p, 'white_knight', whiteKnight, p, [0]);
    assert.equal(get(p, 'wanted_white_knight_kills'), 99, 'attributed White Knight kill lowers reputation');
    set(p, 'wanted_white_knight_kills', 0);
    const lastWhiteKnight = npc('white_knight');
    attributedDeath(p, 'white_knight', lastWhiteKnight, p, [0]);
    assert.equal(get(p, 'wanted_white_knight_kills'), 0, 'White Knight penalty floors at Novice');
}

console.log('PASS Wanted! closeout: Canifis entry, all scan clues, owner-bound encounters, proof recovery, once-only rewards, RD/Devious hooks, rank stock and attributed reputation');
process.exit(0);
