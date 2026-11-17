// Run from the sibling engine after the full pack. No server is started.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async file => (await import(pathToFileURL(path.join(engine, 'src', file)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const Environment = await load('util/Environment.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const ServerTriggerType = await load('engine/script/ServerTriggerType.ts');
const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
    types[name] = await load(`cache/config/${name}.ts`);
    types[name].load(pack);
}
(await load('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load(pack) > 0, 'full compiled pack required');
World.currentTick = 100;
World.gameMap.init();
function id(kind, name) {
    const row = fs.readFileSync(path.join(content, 'pack', `${kind}.pack`), 'utf8').split('\n').find(line => line.slice(line.indexOf('=') + 1) === name);
    assert(row, `missing ${kind} ${name}`);
    return Number(row.slice(0, row.indexOf('=')));
}
const component = name => id('interface', name);
const bit = name => id('varbit', name);
const item = name => id('obj', name);
const inv = types.InvType.getId('inv');
let serial = 0;
function player(stage = 0) {
    const p = new Player(`elid${++serial}`, BigInt(serial), BigInt(serial));
    p.pid = serial; p.slot = serial;
    p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | p.slot) >>> 0;
    p.vars.fill(0); p.packets = []; p.messages = [];
    p.setVarBit(bit('elidquest'), stage);
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.messages.push(text);
    p.wrappedMessageGame = p.messageGame;
    p.x = 3426; p.z = 2929; p.level = 0;
    return p;
}
function npc(name) {
    const type = id('npc', name);
    return new Npc(0, 3425, 2929, 0, 1, EntityLifeCycle.RESPAWN, 1, type, types.NpcType.get(type).blockwalk);
}
function run(name, p, target = null, choices = [], args = []) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing packed ${name}`);
    const state = ScriptRunner.init(script, p, target, args);
    let execution = p.runScript(state, true, true);
    for (let n = 0; execution !== ScriptState.FINISHED && n < 200; n++) {
        if (execution === ScriptState.SUSPENDED) {
            World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
            p.delayed = false;
        } else {
            assert.equal(execution, ScriptState.PAUSEBUTTON, `${name} must not abort`);
            const root = p.modalChat >= 0 ? types.Component.get(p.modalChat).comName : '';
            if (/^multi[2-5]$/.test(root)) {
                assert(choices.length, `${name} unexpected menu ${root}`);
                p.lastCom = component(`${root}:com_${choices.shift()}`);
                assert(p.resumeButtons.includes(p.lastCom), `${name} offered selected option`);
            }
        }
        execution = p.runScript(state, true, true);
    }
    assert.equal(execution, ScriptState.FINISHED, `${name} finishes within page bound`);
    assert.equal(choices.length, 0, `${name} consumed every intended choice; stage=${p.getVarBit(bit('elidquest'))}; script=${state.script.name}; history=${state.executionHistory}; text=${p.packets.filter(packet => packet.constructor.name === 'IfSetText').slice(-5).map(packet => packet.text).join(' ')}`);
    return state;
}
const stage = p => p.getVarBit(bit('elidquest'));
const count = (p, name) => p.invTotal(inv, item(name));
const give = (p, name) => p.invAdd(inv, item(name), 1);
const text = p => p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ');
const use = (name, p, used, target) => { p.lastUseItem = item(used); return run(name, p, target); };
const p = player();
run('[opnpc1,elid_mayor]', p, npc('elid_mayor'), [2]);
assert.equal(stage(p), 0, 'declining does not start');
run('[opnpc1,elid_mayor]', p, npc('elid_mayor'), [1]);
assert.equal(stage(p), 10, 'accept starts at cache-visible stage 10');
run('[opnpc1,elid_ghaslor]', p, npc('elid_ghaslor'), [1]);
assert.equal(stage(p), 20, 'Ghaslor supplies waterfall lead');
assert.equal(count(p, 'elid_ballad'), 1);
run('[opnpc1,elid_ghaslor]', p, npc('elid_ghaslor'), [1]);
assert.equal(count(p, 'elid_ballad'), 1, 'no duplicate held Ballad');
const unstarted = player();
run('[opnpc1,elid_waterspirit]', unstarted, npc('elid_waterspirit'));
assert.equal(stage(unstarted), 0, 'spirits do not start an unaccepted quest');
for (const value of [0, 10, 20, 25, 30, 60]) {
    const q = player(value); give(q, 'elid_sole');
    use('[opnpcu,elid_genie]', q, 'elid_sole', npc('elid_genie'));
    assert.equal(stage(q), value, `trade cannot bypass sole agreement at stage ${value}`);
    assert.equal(count(q, 'elid_sole'), 1);
    assert.equal(count(q, 'elid_statuette'), 0);
}
run('[opnpc1,elid_waterspirit]', p, npc('elid_waterspirit'), [4, 1]);
assert.equal(stage(p), 25, 'spirits explain the discarded statuette');
run('[opnpc1,elid_mayor]', p, npc('elid_mayor'));
assert.equal(stage(p), 30, 'mayor identifies crevice');
assert(text(p).includes('deep crevice in the desert to the west'), 'location is communicated');
run('[opnpc1,elid_genie]', p, npc('elid_genie'), [1, 1, 3]);
assert.equal(stage(p), 40, 'agreement requests sole');
give(p, 'elid_shoes'); give(p, 'knife');
use('[opheldu,elid_shoes]', p, 'knife');
assert.equal(count(p, 'elid_shoes'), 0); assert.equal(count(p, 'elid_sole'), 1);
use('[opnpcu,elid_genie]', p, 'elid_sole', npc('elid_genie'));
assert.equal(stage(p), 50, 'trade earns final pre-completion stage');
assert.equal(count(p, 'elid_sole'), 0); assert.equal(count(p, 'elid_statuette'), 1);
run('[opnpc1,elid_ghaslor]', p, npc('elid_ghaslor'), [1]);
run('[opnpc1,elid_waterspirit]', p, npc('elid_waterspirit'), [4, 1]);
assert.equal(stage(p), 50, 'earlier conversations cannot regress progress');
const before = [PlayerStat.PRAYER, PlayerStat.THIEVING, PlayerStat.MAGIC].map(stat => p.stats[stat]);
const plinth = World.getLoc(3426, 2930, 0, id('loc', 'elid_statuette_multiloc'));
assert(plinth, 'original Nardah plinth is placed');
use('[oplocu,elid_statuette_multiloc]', p, 'elid_statuette', plinth);
assert.equal(stage(p), 60, 'placement completes');
assert.equal(count(p, 'elid_statuette'), 0, 'one statuette consumed');
for (const [i, stat] of [PlayerStat.PRAYER, PlayerStat.THIEVING, PlayerStat.MAGIC].entries()) {
    assert.equal(p.stats[stat] - before[i], [80000, 10000, 10000][i] * Environment.NODE_XPRATE, 'period reward in tenths');
}
assert.equal(p.getVar(id('varp', 'qp')), 2, 'shared recount awards exactly two quest points');
assert.equal(p.modalMain, component('questscroll_death'), 'completion opens actual quest scroll');
assert(text(p).includes('You have completed Spirits of the Elid.'));
assert(text(p).includes('8,000 Prayer XP'));
const after = p.stats.slice();
give(p, 'elid_statuette');
use('[oplocu,elid_statuette_multiloc]', p, 'elid_statuette', plinth);
assert.deepEqual(p.stats, after, 'replay grants no XP');
assert.equal(count(p, 'elid_statuette'), 1, 'replay consumes nothing');
assert.equal(p.getVar(id('varp', 'qp')), 2);
for (const early of [0, 10, 20, 25, 30, 40]) {
    const q = player(early); give(q, 'elid_statuette');
    use('[oplocu,elid_statuette_multiloc]', q, 'elid_statuette', plinth);
    assert.equal(stage(q), early, `unearned statuette stage ${early} cannot complete`);
    assert.equal(count(q, 'elid_statuette'), 1);
}
for (const [value, colour] of [[0, 31 << 10], [10, (31 << 10) | (31 << 5)], [50, (31 << 10) | (31 << 5)], [60, 31 << 5]]) {
    const q = player(value);
    run('[proc,update_questlist]', q);
    const packet = q.packets.filter(packet => packet.constructor.name === 'IfSetColour' && packet.component === component('questlist:elid')).at(-1);
    assert(packet, 'login refresh sends Elid row');
    assert.equal(packet.colour, colour, `stage ${value} login colour`);
    assert.equal(q.getVar(id('varp', 'qp')), value === 60 ? 2 : 0);
}
p.levels[PlayerStat.PRAYER] = 0; p.levels[PlayerStat.HITPOINTS] = 1;
run('[oploc1,elid_statuette_placed]', p, plinth);
assert.equal(p.levels[PlayerStat.PRAYER], p.baseLevels[PlayerStat.PRAYER]);
assert.equal(p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS] + 7);
const parent = types.VarPlayerType.get(id('varp', 'elid_main'));
assert.equal(parent.scope, types.VarPlayerType.SCOPE_PERM, 'stages and flags persist');
const golems = [
    { colour: 'white', door: [3365, 9542], room: [3365, 9541], hall: [3365, 9543] },
    { colour: 'black', door: [3372, 9556], room: [3373, 9556], hall: [3371, 9556] },
    { colour: 'grey', door: [3374, 9547], room: [3375, 9547], hall: [3373, 9547] }
];
for (const { colour, door, room, hall } of golems) {
    const q = player(20);
    q.isActive = true;
    World.players[q.slot] = q; World.playerLoop.add(q.hash64, q);
    const type = types.NpcType.getByName(`elid_golem_${colour}`);
    const actor = new Npc(0, ...door, type.size, type.size, EntityLifeCycle.RESPAWN, World.getNextNid(), type.id, type.blockwalk);
    World.addNpc(actor, -1); World.processNpcEventQueue();
    const spawned = ScriptRunner.init(ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category), actor);
    actor.executeScript(spawned);
    assert.equal(spawned.execution, ScriptState.FINISHED);
    actor.setVar(id('varn', 'npc_aggressive_player'), q.uid);
    actor.heroPoints.addHero(q.hash64, actor.levels[NpcStat.HITPOINTS]);
    actor.applyDamage(actor.levels[NpcStat.HITPOINTS], 1);
    const death = ScriptRunner.init(ScriptProvider.getByName(`[ai_queue3,elid_golem_${colour}]`), actor);
    actor.executeScript(death);
    for (let tick = 0; death.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
        q.processQueues();
        World.currentTick = Math.max(World.currentTick + 1, actor.delayedUntil);
        actor.delayed = false; actor.executeScript(death);
    }
    q.processQueues();
    assert.equal(death.execution, ScriptState.FINISHED, `${colour} death finishes with no secondary NPC`);
    for (const other of golems) assert.equal(q.getVarBit(bit(`elid_${other.colour}golem`)), Number(other.colour === colour), 'only matching death bit is credited');
    const loc = World.getLoc(...door, 0, id('loc', `elid_${colour}golem_door`));
    assert(loc, `${colour} original door is placed`);
    [q.x, q.z] = hall;
    run(`[oploc1,elid_${colour}golem_door]`, q, loc);
    assert.deepEqual([q.x, q.z], room, `${colour} hall to room`);
    run(`[oploc1,elid_${colour}golem_door]`, q, loc);
    assert.deepEqual([q.x, q.z], hall, `${colour} room to hall`);
    assert.equal(stage(q), 20, 'golem credit and crossing do not change quest stage');
    if (actor.isActive) World.removeNpc(actor, -1);
    if (World.npcs.get(actor.nid) === actor) { World.npcs.remove(actor.nid); actor.cleanup(); }
    q.setVarBit(bit(`elid_${colour}golem`), 0);
    run(`[oploc1,elid_${colour}golem_door]`, q, loc);
    run(`[oploc1,elid_${colour}golem_door]`, q, loc);
    const matches = [...World.npcs].filter(n => n.isActive && n.type === type.id && Math.max(Math.abs(n.x - door[0]), Math.abs(n.z - door[1])) <= 4);
    assert.equal(matches.length, 1, `${colour} repeated door click does not duplicate nearby golem`);
    for (const n of matches) World.removeNpc(n, -1);
    World.players[q.slot] = null; q.unlink();
}
const channels = player(20);
run('[oploc1,elid_water_channel_blocked_rocks]', channels);
assert.equal(channels.getVarBit(bit('elid_miningchannel')), 0, 'rubble requires a usable pickaxe');
give(channels, 'bronze_pickaxe');
run('[oploc1,elid_water_channel_blocked_rocks]', channels);
assert.equal(channels.getVarBit(bit('elid_miningchannel')), 1);
run('[oploc1,elid_water_channel_spiketrap]', channels);
assert.equal(channels.getVarBit(bit('elid_thievingchannel')), 1);
run('[opnpc2,elid_ranging_target]', channels, npc('elid_ranging_target'));
assert.equal(channels.getVarBit(bit('elid_rangingchannel')), 0, 'target needs equipment');
const worn = types.InvType.getId('worn');
channels.getInventory(worn).set(3, { id: item('shortbow'), count: 1 });
channels.getInventory(worn).set(13, { id: item('bronze_arrow'), count: 2 });
run('[opnpc2,elid_ranging_target]', channels, npc('elid_ranging_target'));
assert.equal(channels.getVarBit(bit('elid_rangingchannel')), 1);
assert.equal(channels.invTotal(worn, item('bronze_arrow')), 1, 'target consumes one arrow');
assert.equal(stage(channels), 20, 'channel bits are independent of quest stage');
const lake = World.getLoc(3354, 9558, 0, id('loc', 'elid_underground_lake_door'));
assert(lake);
for (const missing of ['elid_miningchannel', 'elid_thievingchannel', 'elid_rangingchannel']) {
    channels.x = 3354; channels.z = 9557; channels.setVarBit(bit(missing), 0);
    run('[oploc1,elid_underground_lake_door]', channels, lake);
    assert.equal(channels.z, 9557, `${missing} must be restored before lake entry`);
    channels.setVarBit(bit(missing), 1);
}
run('[oploc1,elid_underground_lake_door]', channels, lake);
assert.deepEqual([channels.x, channels.z], [3354, 9559], 'all channels permit lake entry');
run('[oploc1,elid_underground_lake_door]', channels, lake);
assert.deepEqual([channels.x, channels.z], [3354, 9557], 'lake return remains usable');
console.log('PASS compiled stage ladder 0→10→20→25→30→40→50→60; once-only XP/QP/scroll, gates, login colours and shrine');
process.exit(0);
