#!/usr/bin/env node
// Expected Sweep values are authored from weapon-combat research and the unit brief.
// Real VM, handlers, hunts and damage queues. No stored traces or generated IDs.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = name => import(pathToFileURL(path.join(engine, name)).href);
const World = (await load('src/engine/World.ts')).default;
const Provider = (await load('src/engine/script/ScriptProvider.ts')).default;
const Runner = (await load('src/engine/script/ScriptRunner.ts')).default;
const State = (await load('src/engine/script/ScriptState.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const Trigger = (await load('src/engine/script/ServerTriggerType.ts')).default;
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const ZoneMap = (await load('src/engine/zone/ZoneMap.ts')).default;
const { CoordGrid } = await load('src/engine/CoordGrid.ts');
const IfButton = (await load('src/network/game/client/model/IfButton.ts')).default;
const IfButtonHandler = (await load('src/network/game/client/handler/IfButtonHandler.ts')).default;
const OpPlayer = (await load('src/network/game/client/model/OpPlayer.ts')).default;
const OpPlayerHandler = (await load('src/network/game/client/handler/OpPlayerHandler.ts')).default;
const { PlayerInfoProt } = await load('src/network/rsbuf/prot.ts');
const rsbuf = await load('src/network/rsbuf/index.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'ObjType',
    'InvType', 'ParamType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType',
    'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
    types[name] = (await load(`src/cache/config/${name}.ts`)).default;
    types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
Environment.NODE_MEMBERS = true;
Environment.NODE_PRODUCTION = false;
Environment.NODE_DEBUG_PROFILE = false;
assert(Provider.load(pack) > 0, 'real packed scripts required');
World.gameMap.init();
World.currentTick = 1000;
const id = (kind, name) => { const n = types[kind].getId(name); assert(n >= 0, `${kind}:${name}`); return n; };
const variable = (p, name, value) => value === undefined ? p.getVar(id('VarPlayerType', name)) : p.setVar(id('VarPlayerType', name), value);
const worn = id('InvType', 'worn'), inv = id('InvType', 'inv');
const halberd = types.ObjType.getByName('dragon_halberd');
assert(halberd, 'dragon halberd exists');
const smallType = types.NpcType.configs.find(t => t?.name === 'Goblin' && t.size === 1 && t.op?.[1] === 'Attack');
const largeType = types.NpcType.configs.find(t => t?.name === 'Hill giant' && t.size > 1 && t.op?.[1] === 'Attack');
assert(smallType && largeType, 'one-tile and large native NPC fixtures exist');
const param = (t, name) => { const p = types.ParamType.getByName(name); assert(p, name); return t.params?.get(p.id) ?? p.defaultInt; };
const level99Experience = 130344310; // Internal XP tenths, matching the real level-99 threshold.
assert.equal(param(halberd, 'sa_energy'), 300, 'authored 30% Sweep cost');
assert.equal(param(halberd, 'specwep'), 1, 'halberd exposes its special bar');
let serial = 0, watching = false, states = [];
const realExecute = Runner.execute;
Runner.execute = function (state) {
    const result = realExecute.call(this, state);
    if (watching) states.push(state);
    return result;
};
function run(p, name, args = [], target = null) {
    const script = Provider.getByName(name); assert(script, name);
    const state = Runner.init(script, p, target, args);
    assert.equal(p.runScript(state, true, true), State.FINISHED, name);
    return state;
}
function player(f, x = 3100, z = 3800) {
    const slot = ++serial;
    const p = new Player(`halberd${slot}`, BigInt(slot), BigInt(slot));
    p.slot = p.pid = slot; p.uid = (slot << 11) | slot; p.isActive = true;
    p.x = p.originX = x; p.z = p.originZ = z; p.level = 0;
    p.levels.fill(99); p.baseLevels.fill(99); p.stats.fill(level99Experience);
    p.messages = []; p.packets = [];
    p.messageGame = p.wrappedMessageGame = text => p.messages.push(String(text));
    p.write = packet => p.packets.push(packet);
    World.players[slot] = p; World.playerLoop.add(p.hash64, p);
    p.getInventory(worn); p.getInventory(inv);
    variable(p, 'tutorial', 1000); variable(p, 'option_nodef', 1);
    const zone = World.gameMap.getZone(x, z, 0); zone.enter(p);
    f.players.push({ p, zone });
    return p;
}
function npc(f, type = smallType, x = f.p.x + 1, z = f.p.z) {
    const n = new Npc(0, x, z, type.size, type.size, EntityLifeCycle.RESPAWN, World.getNextNid(), type.id, type.blockwalk);
    World.addNpc(n, -1); World.processNpcEventQueue(); n.lastMovement = -100;
    n.levels.fill(1); n.baseLevels.fill(1); n.levels[3] = n.baseLevels[3] = 255;
    n.setVar(id('VarNpcType', 'npc_combat_xp_multiplier'), 1000);
    f.npcs.push(n); return n;
}
function fixture(x = 3100, z = 3800) {
    const f = { players: [], npcs: [], zones: new Map() };
    f.p = player(f, x, z);
    f.p.invSet(worn, halberd.id, 1, halberd.wearpos);
    variable(f.p, 'com_mode', 1); // Swipe: aggressive slash, unchanged by this unit.
    run(f.p, '[proc,update_weapon_category]', [halberd.id]);
    run(f.p, '[proc,player_combat_stat]');
    variable(f.p, 'com_maxhit', 20); variable(f.p, 'com_slashattack', 10000);
    variable(f.p, 'sa_energy', 1000); variable(f.p, 'sa_attack', 1);
    return f;
}
function multi(f, entity, yes = true) {
    const key = ZoneMap.zoneIndex(entity.x, entity.z, entity.level);
    if (!f.zones.has(key)) f.zones.set(key, World.gameMap.isMulti(CoordGrid.packCoord(entity.level, entity.x, entity.z)));
    World.gameMap.setMultiZone(key, yes);
}
function dispose(f) {
    for (const [key, was] of f.zones) World.gameMap.setMultiZone(key, was);
    for (const n of f.npcs) World.removeNpc(n, 0);
    for (const { p, zone } of f.players) { zone.leave(p); World.players[p.slot] = null; p.unlink(); p.cleanup(); }
}
function observe(f, action) {
    const random = JavaRandom.nextDouble;
    let draw = 0; states = []; watching = true;
    JavaRandom.nextDouble = () => [0.999999, 0, 0.999999][draw++ % 3];
    try { action(); }
    finally { JavaRandom.nextDouble = random; watching = false; }
    for (const { p } of f.players) assert(!p.messages.some(m => /script error/i.test(m)), p.messages.join(' | '));
    assert(states.every(s => s.execution === State.FINISHED), 'every real VM execution finishes');
    return states;
}
function attack(f, target) {
    f.p.setInteraction(Interaction.ENGINE, target, Trigger.APNPC2);
    assert.equal(f.p.getOpTrigger()?.name, '[opnpc2,_]', 'engine chooses ordinary NPC attack dispatch');
    return observe(f, () => f.p.processInteraction());
}
const npcHits = n => [...n.queue.all()].filter(q => q.queueId === Trigger.AI_QUEUE2);
const playerHits = p => [...p.queue.all()].filter(q => q.script?.name === '[queue,pvp_damage]');
const damage = n => npcHits(n).map(q => q.lastInt);
function consumed(f) {
    assert.equal(variable(f.p, 'sa_energy'), 700, 'energy is deducted once, even for several victims');
    assert.equal(variable(f.p, 'sa_attack'), 0, 'the consumed special disables its toggle');
}
function test(name, fn) { fn(); console.log(`PASS ${name}`); }

test('polearm tab native toggle, energy display and weapon-change reset', () => {
    const f = fixture();
    try {
        const root = id('Component', 'combat_polearm');
        assert(f.p.tabs.includes(root), 'real weapon update opens polearm tab');
        const button = id('Component', 'combat_polearm:specbar');
        assert.equal(Provider.getByTrigger(Trigger.IF_BUTTON, button, -1)?.name, '[if_button,combat_polearm:specbar]');
        variable(f.p, 'sa_attack', 0);
        assert.equal(new IfButtonHandler().handle(new IfButton(button), f.p), true);
        assert.equal(variable(f.p, 'sa_attack'), 1, 'real button enables special');
        assert.equal(new IfButtonHandler().handle(new IfButton(button), f.p), true);
        assert.equal(variable(f.p, 'sa_attack'), 0, 'real button disables special');
        const display = types.Component.getByName('combat_polearm:com_34');
        assert(display.scripts?.some(program => program.includes(id('VarPlayerType', 'sa_energy'))), 'original client component reads received energy');
        variable(f.p, 'sa_attack', 1);
        run(f.p, '[proc,try_unequip]', [halberd.wearpos]);
        assert.equal(variable(f.p, 'sa_attack'), 0, 'normal unequip resets toggle');
    } finally { dispose(f); }
});

test('one-tile NPC gets one 110% hit with XP and one cost', () => {
    const f = fixture();
    try {
        const n = npc(f); multi(f, f.p, false);
        attack(f, n); consumed(f);
        assert.equal(npcHits(n).length, 1);
        assert.deepEqual(damage(n), [22], 'authored maxhit 20 scales to 22');
        assert(f.p.stats[2] > level99Experience, 'selected aggressive style awards Strength XP');
    } finally { dispose(f); }
});

test('large NPC gets two full hits and no side-target hunt', () => {
    const f = fixture();
    try {
        const n = npc(f, largeType), side = npc(f, smallType, n.x, n.z + 1);
        multi(f, f.p); multi(f, n); multi(f, side);
        attack(f, n); consumed(f);
        assert.equal(npcHits(n).length, 2, 'large-target second hit exists');
        assert.deepEqual(damage(n), [22, 22], 'both large-target hits retain full accuracy');
        assert.equal(f.p.stats[2] - level99Experience, 1760, '44 damage awards 44 x 4 x 10 Strength XP tenths');
        assert.equal(npcHits(side).length, 0, 'large primary ends without a neighbour sweep');
    } finally { dispose(f); }
});

test('large NPC overkill awards experience only for its remaining hitpoints', () => {
    const f = fixture();
    try {
        const n = npc(f, largeType);
        n.levels[3] = n.baseLevels[3] = 8;
        attack(f, n); consumed(f);
        assert.deepEqual(damage(n), [22, 22], 'both rolled hits are queued unchanged');
        // Aggressive style: 8 hitpoints x 4 XP per damage x 10 internal tenths.
        assert.equal(f.p.stats[2] - level99Experience, 320, 'same-tick hits award XP for exactly the 8 hitpoints available');
    } finally { dispose(f); }
});

test('multiway sweep hits only eligible side tiles and restores the primary NPC', () => {
    const f = fixture();
    try {
        const n = npc(f), north = npc(f, smallType, n.x, n.z + 1), south = npc(f, smallType, n.x, n.z - 1);
        const behind = npc(f, smallType, n.x + 1, n.z), otherKind = player(f, n.x, n.z + 1);
        for (const e of [f.p, ...f.npcs, otherKind]) multi(f, e);
        const executions = attack(f, n); consumed(f);
        for (const victim of [n, north, south]) assert.equal(npcHits(victim).length, 1, 'primary and side pair each receive one hit');
        assert.equal(npcHits(behind).length, 0, 'not a general 3x3 sweep');
        assert.equal(playerHits(otherKind).length, 0, 'NPC primary cannot hit a player');
        assert(executions.some(s => s._activeNpc === n), 'native NPC pointer restores after hunt');
    } finally { dispose(f); }
});

test('single-combat and Slayer-ineligible neighbours are not swept', () => {
    const f = fixture();
    try {
        const n = npc(f), single = npc(f, smallType, n.x, n.z - 1);
        const kurask = types.NpcType.configs.find(t => t?.name === 'Kurask' && t.op?.[1] === 'Attack'); assert(kurask);
        const gated = npc(f, kurask, n.x, n.z + 1);
        multi(f, f.p); multi(f, n); multi(f, gated); multi(f, single, false);
        f.p.levels[18] = 1;
        attack(f, n); consumed(f);
        assert.equal(npcHits(n).length, 1);
        assert.equal(npcHits(single).length, 0, 'secondary tile must itself be multiway');
        assert.equal(npcHits(gated).length, 0, 'quiet secondary admission retains Slayer level');
    } finally { dispose(f); }
});

test('short energy refuses the special without cost or hit', () => {
    const f = fixture();
    try {
        const n = npc(f); variable(f.p, 'sa_energy', 299);
        attack(f, n);
        assert.equal(variable(f.p, 'sa_energy'), 299);
        assert.equal(variable(f.p, 'sa_attack'), 0);
        assert.equal(npcHits(n).length, 0);
        assert(f.p.messages.some(m => m.includes("don't have enough power")));
    } finally { dispose(f); }
});

test('leaf-bladed weapon gate prevents halberd damage before XP', () => {
    const f = fixture();
    try {
        const t = types.NpcType.configs.find(t => t?.name === 'Kurask' && t.op?.[1] === 'Attack'); assert(t);
        const n = npc(f, t); attack(f, n); consumed(f);
        assert(npcHits(n).length > 0);
        assert(damage(n).every(value => value === 0), 'required weapon gate caps every special hit');
        assert.equal(f.p.stats[2], level99Experience, 'forbidden damage awards no Strength XP');
    } finally { dispose(f); }
});

test('Slayer level and quest refusals preserve energy', () => {
    for (const name of ['Kurask', 'General Khazard']) {
        const f = fixture();
        try {
            const t = types.NpcType.configs.find(t => t?.name === name && t.op?.[1] === 'Attack'); assert(t, name);
            const n = npc(f, t); if (name === 'Kurask') f.p.levels[18] = 1;
            attack(f, n);
            assert.equal(variable(f.p, 'sa_energy'), 1000, `${name} is refused before cost`);
            assert.equal(npcHits(n).length, 0);
        } finally { dispose(f); }
    }
});

function pvpAttack(f, primary) {
    rsbuf.addPlayer(f.p.slot); rsbuf.addPlayer(primary.slot);
    try {
        f.p.masks |= PlayerInfoProt.APPEARANCE; primary.masks |= PlayerInfoProt.APPEARANCE;
        World.processInfo();
        rsbuf.playerInfo(0, f.p.slot, 0, 0, true); rsbuf.playerInfo(0, primary.slot, 0, 0, true);
        assert(rsbuf.hasPlayer(f.p.slot, primary.slot), 'received target is visible to native input');
        f.p.resetEntity(false); primary.resetEntity(false);
        return observe(f, () => {
            assert.equal(new OpPlayerHandler().handle(new OpPlayer(2, primary.slot), f.p), true);
            assert.equal(f.p.getOpTrigger()?.name, '[opplayer2,_]');
            f.p.processInteraction();
        });
    } finally { rsbuf.removePlayer(f.p.slot); rsbuf.removePlayer(primary.slot); rsbuf.cleanup(); }
}

test('native PvP attack, side pair, no cross-kind damage and pointer restoration', () => {
    const f = fixture();
    try {
        const primary = player(f, f.p.x + 1, f.p.z), north = player(f, primary.x, primary.z + 1), south = player(f, primary.x, primary.z - 1);
        const wrong = player(f, primary.x + 1, primary.z), otherKind = npc(f, smallType, primary.x, primary.z + 1);
        for (const e of [f.p, primary, north, south, wrong, otherKind]) multi(f, e);
        const victimXp = [primary, north, south, wrong].map(p => [...p.stats]);
        const executions = pvpAttack(f, primary); consumed(f);
        for (const victim of [primary, north, south]) assert.equal(playerHits(victim).length, 1, `eligible player victim ${victim.slot} uses published damage queue`);
        assert.equal(playerHits(wrong).length, 0); assert.equal(npcHits(otherKind).length, 0);
        // Each level-126 victim: 22 damage x 4 XP x 10 tenths x 1125/1000 = 990.
        assert.equal(f.p.stats[2] - level99Experience, 2970, 'caster gains Strength XP for all three eligible victims');
        [primary, north, south, wrong].forEach((p, i) => assert.deepEqual([...p.stats], victimXp[i], 'bystander experience is unchanged'));
        assert(executions.some(s => s._activePlayer === f.p && s._activePlayer2 === primary), 'caster and primary pointers restore');
    } finally { dispose(f); }
});

test('native PvP attack refuses targets outside the Wilderness', () => {
    const f = fixture(3100, 3200);
    try {
        const primary = player(f, f.p.x + 1, 3200);
        pvpAttack(f, primary);
        assert.equal(variable(f.p, 'sa_energy'), 1000); assert.equal(playerHits(primary).length, 0);
    } finally { dispose(f); }
});
test('Mage Arena refuses a halberd special against NPCs and players', () => {
    for (const pvp of [false, true]) {
        // Inside the original mage_arena coord-pair rows.
        const f = fixture(3100, 3930);
        try {
            const target = pvp ? player(f, f.p.x + 1, f.p.z) : npc(f);
            if (pvp) pvpAttack(f, target);
            else attack(f, target);
            assert.equal(variable(f.p, 'sa_energy'), 1000);
            assert.equal((pvp ? playerHits(target) : npcHits(target)).length, 0);
            assert(f.p.messages.some(m => m.includes('only magical combat')));
        } finally { dispose(f); }
    }
});

console.log('halberd-special: all compiled contracts passed');
process.exit(0); // World imports own maintenance timers; this offline process owns no live server.
