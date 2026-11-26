#!/usr/bin/env node
// Authored special costs/effects, real compiled VM, native buttons and attack options.
// Packed special weapons are discovered at runtime; no generated ids or execution traces are pinned.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const { PlayerTimerType } = await load('src/engine/entity/EntityTimer.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const IfButton = (await load('src/network/game/client/model/IfButton.ts')).default;
const IfButtonHandler = (await load('src/network/game/client/handler/IfButtonHandler.ts')).default;
const OpPlayer = (await load('src/network/game/client/model/OpPlayer.ts')).default;
const OpPlayerHandler = (await load('src/network/game/client/handler/OpPlayerHandler.ts')).default;
const { PlayerInfoProt } = await load('src/network/rsbuf/prot.ts');
const rsbuf = await load('src/network/rsbuf/index.ts');
const SynthSound = (await load('src/network/game/server/model/SynthSound.ts')).default;
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

const id = (kind, name) => {
    const value = types[kind].getId(name);
    assert(value >= 0, `${kind}:${name}`);
    return value;
};
const variable = (player, name, value) => value === undefined
    ? player.getVar(id('VarPlayerType', name))
    : player.setVar(id('VarPlayerType', name), value);
const worn = id('InvType', 'worn');
const inventory = id('InvType', 'inv');
const rightHand = types.ObjType.getWearPosId('righthand');
const quiver = types.ObjType.getWearPosId('quiver');
assert(rightHand >= 0 && quiver >= 0, 'packed right-hand and quiver slots exist');
const param = (type, name) => {
    const definition = types.ParamType.getByName(name);
    assert(definition, `packed parameter ${name} exists`);
    return type.params?.get(definition.id) ?? definition.defaultInt;
};
const itemNames = new Map([...types.ObjType.configNames].map(([name, objectId]) => [objectId, name]));
const itemName = item => itemNames.get(item.id) ?? item.name ?? `object_${item.id}`;
const level99Experience = 130344310;
const damageType = { stab: 0, slash: 1, crush: 2, ranged: 3 };
const expectedCost = new Map([
    ['excalibur', 1000], ['rune_thrownaxe', 100], ['magic_longbow', 350], ['magic_shortbow', 550],
    ['dragon_dagger', 250], ['dragon_dagger_p', 250], ['dragon_spear', 250], ['dragon_spear_p', 250],
    ['dragon_longsword', 250], ['dragon_battleaxe', 1000], ['dragon_mace', 250], ['rune_claws', 250],
    ['tbwt_dragon_spear_kp', 250], ['dragon_halberd', 300], ['abyssal_whip', 500],
    ['granite_maul', 500], ['dragon_scimitar', 550], ['darklight', 500]
]);
const directEffects = new Set(['excalibur', 'dragon_battleaxe']);
const pvmHandler = {
    rune_thrownaxe: 'pvm_rune_thrownaxe_sa', magic_longbow: 'pvm_magic_longbow_sa',
    magic_shortbow: 'pvm_magic_shortbow_sa', dragon_dagger: 'pvm_dragon_dagger_sa',
    dragon_dagger_p: 'pvm_dragon_dagger_sa', dragon_spear: 'pvm_dragon_spear_sa',
    dragon_spear_p: 'pvm_dragon_spear_sa', tbwt_dragon_spear_kp: 'pvm_dragon_spear_sa',
    dragon_longsword: 'pvm_dragon_longsword_sa', dragon_mace: 'pvm_dragon_mace_sa',
    rune_claws: 'pvm_rune_claws_sa', dragon_halberd: 'pvm_dragon_halberd_sa',
    abyssal_whip: 'pvm_abyssal_whip_sa', granite_maul: 'pvm_granite_maul_sa',
    dragon_scimitar: 'pvm_dragon_scimitar_sa', darklight: 'agrith_darklight_special'
};
const pvpHandler = {
    rune_thrownaxe: 'pvp_rune_thrownaxe_sa', magic_longbow: 'pvp_magic_longbow_sa',
    magic_shortbow: 'pvp_magic_shortbow_sa', dragon_dagger: 'pvp_dragon_dagger_sa',
    dragon_dagger_p: 'pvp_dragon_dagger_sa', dragon_spear: 'pvp_dragon_spear_sa',
    dragon_spear_p: 'pvp_dragon_spear_sa', tbwt_dragon_spear_kp: 'pvp_dragon_spear_sa',
    dragon_longsword: 'pvp_dragon_longsword_sa', dragon_mace: 'pvp_dragon_mace_sa',
    rune_claws: 'pvp_rune_claws_sa', dragon_halberd: 'pvp_dragon_halberd_sa',
    abyssal_whip: 'pvp_abyssal_whip_sa', granite_maul: 'pvp_granite_maul_sa',
    dragon_scimitar: 'pvp_dragon_scimitar_sa', darklight: 'agrith_darklight_pvp_special'
};
const rodCharges = new Map(Array.from({ length: 10 }, (_, index) =>
    [`burgh_rod_command_final_${index + 1}`, index + 1]));
for (const name of rodCharges.keys()) {
    expectedCost.set(name, 100);
    pvmHandler[name] = 'myreque2_rod_capture';
    pvpHandler[name] = 'pvp_melee_attack';
}
const stunWeapons = new Set(['dragon_spear', 'dragon_spear_p', 'tbwt_dragon_spear_kp']);
const doubleHitWeapons = new Set(['dragon_dagger', 'dragon_dagger_p', 'magic_shortbow']);
const prayerLockId = Provider.getByName('[timer,dragon_scimitar_prayer_lock]')?.id;
assert(Number.isInteger(prayerLockId), 'compiled scimitar prayer-lock timer exists');
const synthIds = new Map(readFileSync(path.join(content, 'pack/synth.pack'), 'utf8')
    .trim().split(/\r?\n/).map(line => {
        const separator = line.indexOf('=');
        return [line.slice(separator + 1), Number(line.slice(0, separator))];
    }));
const prayerOffSynth = synthIds.get('prayer_off');
assert(Number.isInteger(prayerOffSynth), 'packed prayer_off sound exists');

const specialWeapons = types.ObjType.configs.filter(item => item && param(item, 'specwep') === 1);
assert(specialWeapons.length > 0, 'packed special-enabled items are discovered dynamically');
for (const item of specialWeapons) {
    const name = itemName(item);
    assert(expectedCost.has(name), `${name} has an authored expected special cost`);
    assert.equal(param(item, 'sa_energy'), expectedCost.get(name), `${name} retains its authored special cost`);
    assert.equal(item.wearpos, rightHand, `${name} is a right-hand special weapon`);
    if (!directEffects.has(name)) {
        assert(pvmHandler[name], `${name} has an authored PvM route expectation`);
        assert(pvpHandler[name], `${name} has an authored PvP route expectation`);
    }
}

let serial = 0;
let watching = false;
let states = [];
const realExecute = Runner.execute;
Runner.execute = function (state) {
    const result = realExecute.call(this, state);
    if (watching) states.push(state);
    return result;
};

function run(player, name, args = [], target = null) {
    const script = Provider.getByName(name);
    assert(script, `compiled script ${name} exists`);
    const state = Runner.init(script, player, target, args);
    assert.equal(player.runScript(state, true, true), State.FINISHED, `${name} finishes`);
    return state;
}
function procInt(player, name, args = [], target = null) {
    const state = run(player, name, args, target);
    assert(state.isp > 0, `${name} returns an integer`);
    return state.intStack[state.isp - 1];
}
function player(f, x = 3100, z = 3800) {
    const slot = ++serial;
    const p = new Player(`specialroutes${slot}`, BigInt(slot), BigInt(slot));
    p.slot = p.pid = slot;
    p.uid = (slot << 11) | slot;
    p.isActive = true;
    p.x = p.originX = x;
    p.z = p.originZ = z;
    p.level = 0;
    p.levels.fill(99);
    p.baseLevels.fill(99);
    p.stats.fill(level99Experience);
    p.messages = [];
    p.packets = [];
    p.messageGame = p.wrappedMessageGame = text => p.messages.push(String(text));
    p.write = packet => p.packets.push(packet);
    p.getInventory(worn);
    p.getInventory(inventory);
    variable(p, 'tutorial', 1000);
    variable(p, 'option_nodef', 1);
    variable(p, 'action_delay', 0);
    const zone = World.gameMap.getZone(x, z, 0);
    zone.enter(p);
    World.players[slot] = p;
    World.playerLoop.add(BigInt(slot), p);
    f.players.push({ p, zone });
    run(p, '[proc,initalltabs]');
    return p;
}
function playerHits(p) {
    return [...p.queue.all()].filter(request => request.script?.name === '[queue,pvp_damage]');
}
function npcHits(n) {
    return [...n.queue.all()].filter(request => request.queueId === Trigger.AI_QUEUE2);
}
function npc(f, type = types.NpcType.configs.find(t => t?.name === 'Goblin' && t.size === 1 && t.op?.[1] === 'Attack'),
    x = f.p.x + 1, z = f.p.z) {
    assert(type, 'one-tile Attack NPC fixture exists');
    const n = new Npc(0, x, z, type.size, type.size, EntityLifeCycle.RESPAWN, World.getNextNid(), type.id, type.blockwalk);
    World.addNpc(n, -1);
    World.processNpcEventQueue();
    n.lastMovement = -100;
    n.levels.fill(1);
    n.baseLevels.fill(1);
    n.levels[PlayerStat.HITPOINTS] = n.baseLevels[PlayerStat.HITPOINTS] = 255;
    n.setVar(id('VarNpcType', 'npc_combat_xp_multiplier'), 1000);
    f.npcs.push(n);
    return n;
}
function ammoFor(item) {
    const bow = id('CategoryType', 'weapon_bow');
    const crossbow = id('CategoryType', 'weapon_crossbow');
    if (item.category !== bow && item.category !== crossbow) return null;
    const ammoCategory = item.category === crossbow ? id('CategoryType', 'bolts') : id('CategoryType', 'arrows');
    const compatible = types.ObjType.configs.find(candidate => candidate && candidate.wearpos === quiver
        && candidate.category === ammoCategory
        && param(candidate, 'levelrequire') <= param(item, 'levelrequire'));
    assert(compatible, `${itemName(item)} has packed compatible quiver ammunition`);
    return compatible;
}
function setAttackRolls(p, value) {
    for (const style of ['stab', 'slash', 'crush', 'range', 'magic']) {
        variable(p, `com_${style}attack`, value);
    }
}
function fixture(item, { x = 3100, z = 3800, mode = 1, combatData = true } = {}) {
    const f = { players: [], npcs: [] };
    f.p = player(f, x, z);
    const thrown = item.category === id('CategoryType', 'weapon_thrown')
        || item.category === id('CategoryType', 'weapon_javelin');
    f.p.invSet(worn, item.id, thrown ? 10 : 1, item.wearpos);
    const ammo = ammoFor(item);
    if (ammo) f.p.invSet(worn, ammo.id, 20, quiver);
    variable(f.p, 'com_mode', mode);
    run(f.p, '[proc,update_weapon_category]', [item.id]);
    if (combatData) run(f.p, '[proc,player_combat_stat]');
    variable(f.p, 'com_maxhit', 20);
    setAttackRolls(f.p, 1000000);
    variable(f.p, 'sa_energy', 1000);
    variable(f.p, 'sa_attack', 0);
    variable(f.p, 'action_delay', 0);
    return f;
}
function dispose(f) {
    for (const n of f.npcs) World.removeNpc(n, 0);
    for (const { p, zone } of f.players) {
        zone.leave(p);
        World.players[p.slot] = null;
        p.unlink();
        p.cleanup();
    }
}
function assertHealthy(f, context) {
    for (const { p } of f.players) {
        assert(!p.messages.some(message => /script error/i.test(message)), `${context}: no script error`);
        const invalid = p.packets.filter(packet => packet instanceof SynthSound)
            .find(packet => !Number.isInteger(packet.synth) || packet.synth < 0);
        assert(!invalid, `${context}: no null/invalid synth sound`);
    }
}
function observe(f, action, draws = [0.999999], allowedSuspensions = []) {
    const random = JavaRandom.nextDouble;
    let draw = 0;
    states = [];
    watching = true;
    JavaRandom.nextDouble = () => draws[draw++ % draws.length];
    try { action(); }
    finally {
        JavaRandom.nextDouble = random;
        watching = false;
    }
    assert(states.every(state => state.execution === State.FINISHED || allowedSuspensions.includes(state.execution)),
        'every real VM execution finishes or reaches its authored NPC/player delay');
    assertHealthy(f, 'native combat action');
    return states;
}
function attackNpc(f, target, draws, allowedSuspensions = []) {
    f.p.setInteraction(Interaction.ENGINE, target, Trigger.APNPC2);
    assert.equal(f.p.getOpTrigger()?.name, '[opnpc2,_]', 'engine chooses native NPC Attack dispatch');
    return observe(f, () => f.p.processInteraction(), draws, allowedSuspensions);
}
function attackPlayer(f, target, draws, allowedSuspensions = []) {
    rsbuf.addPlayer(f.p.slot);
    rsbuf.addPlayer(target.slot);
    try {
        f.p.masks |= PlayerInfoProt.APPEARANCE;
        target.masks |= PlayerInfoProt.APPEARANCE;
        World.processInfo();
        rsbuf.playerInfo(0, f.p.slot, 0, 0, true);
        rsbuf.playerInfo(0, target.slot, 0, 0, true);
        assert(rsbuf.hasPlayer(f.p.slot, target.slot), 'native PvP target is visible to the client input handler');
        f.p.resetEntity(false);
        target.resetEntity(false);
        return observe(f, () => {
            assert.equal(new OpPlayerHandler().handle(new OpPlayer(2, target.slot), f.p), true,
                'native player Attack option is handled');
            assert.equal(f.p.getOpTrigger()?.name, '[opplayer2,_]', 'engine chooses native player Attack dispatch');
            f.p.processInteraction();
        }, draws, allowedSuspensions);
    } finally {
        rsbuf.removePlayer(f.p.slot);
        rsbuf.removePlayer(target.slot);
        rsbuf.cleanup();
    }
}
function activeSpecialButton(p) {
    const root = p.tabs.map(componentId => types.Component.get(componentId)).find(component => component?.comName
        && component.comName.startsWith('combat_')
        && types.Component.getByName(`${component.comName}:specbar`));
    assert(root, 'equipped weapon opened its real combat tab with a special bar');
    const button = types.Component.getByName(`${root.comName}:specbar`);
    assert(button, `${root.comName} has a packed special button`);
    assert.equal(Provider.getByTrigger(Trigger.IF_BUTTON, button.id, -1)?.name,
        `[if_button,${root.comName}:specbar]`, 'packed special button has its real VM handler');
    return button;
}
function pressButton(p, componentName) {
    const button = types.Component.getByName(componentName);
    assert(button, `packed button ${componentName} exists`);
    assert(Provider.getByTrigger(Trigger.IF_BUTTON, button.id, -1), `${componentName} is dispatched by the VM`);
    assert.equal(new IfButtonHandler().handle(new IfButton(button.id), p), true,
        `${componentName} goes through the native IfButtonHandler`);
}
function pressSpecial(p) {
    const button = activeSpecialButton(p);
    assert.equal(new IfButtonHandler().handle(new IfButton(button.id), p), true,
        `${button.comName} goes through the native IfButtonHandler`);
}
function assertHandler(executions, name) {
    assert(executions.some(state => state.script?.name === `[label,${name}]`),
        `compiled option dispatch executes ${name}`);
}
function assertCostAndConsumed(f, item, before = 1000) {
    assert.equal(variable(f.p, 'sa_energy'), before - param(item, 'sa_energy'),
        `${itemName(item)} consumes its authored cost exactly once`);
    assert.equal(variable(f.p, 'sa_attack'), 0, `${itemName(item)} consumes the special toggle`);
}
function chooseMode(p, desiredDamageType = null, desiredDamageStyle = null) {
    for (let mode = 0; mode < 4; mode++) {
        variable(p, 'com_mode', mode);
        run(p, '[proc,player_combat_stat]');
        if ((desiredDamageType === null || variable(p, 'damagetype') === desiredDamageType)
            && (desiredDamageStyle === null || variable(p, 'damagestyle') === desiredDamageStyle)) return mode;
    }
    assert.fail(`packed weapon exposes a requested combat style: type=${desiredDamageType}, style=${desiredDamageStyle}`);
}
function boundaryAttack(defenceRoll, accuracyPercent) {
    const defenseAtPointNine = Math.trunc(0.9 * (defenceRoll + 1));
    for (let base = 1; base < defenceRoll; base++) {
        const boosted = Math.floor(base * accuracyPercent / 100);
        const ordinaryAtPointNine = Math.trunc(0.9 * (base + 1));
        const boostedAtPointNine = Math.trunc(0.9 * (boosted + 1));
        if (ordinaryAtPointNine <= defenseAtPointNine && boostedAtPointNine > defenseAtPointNine) return base;
    }
    assert.fail(`can place an authored roll boundary for defence=${defenceRoll}, accuracy=${accuracyPercent}%`);
}
function prayerVarFor(name) {
    return ({
        prayer_protectfrommelee: 'prayer14',
        prayer_protectfrommissiles: 'prayer13',
        prayer_protectfrommagic: 'prayer12',
        prayer_thickskin: 'prayer0'
    })[name];
}
function activatePrayer(p, name) {
    const variableName = prayerVarFor(name);
    assert(variableName, `${name} has an authored prayer-state variable`);
    pressButton(p, `prayer:${name}`);
    assert.equal(variable(p, variableName), 1, `${name} activates through its native button`);
}
function withParam(type, name, value, action) {
    const definition = types.ParamType.getByName(name);
    assert(definition, `packed parameter ${name} exists`);
    const params = type.params;
    const had = params.has(definition.id);
    const previous = params.get(definition.id);
    params.set(definition.id, value);
    try { return action(); }
    finally {
        if (had) params.set(definition.id, previous);
        else params.delete(definition.id);
    }
}
function isSpearPushQueued(target) {
    return [...target.queue.all()].some(request => request.script?.name.startsWith('[queue,pvp_dragon_spear_push_'));
}
function assertNpcSpecialEffect(name, target) {
    if (stunWeapons.has(name)) {
        assert(target.delayed && target.delayedUntil > World.currentTick,
            `${name} applies its real NPC delay rather than requiring damage`);
        return;
    }
    const hits = npcHits(target);
    const expected = doubleHitWeapons.has(name) ? 2 : 1;
    assert.equal(hits.length, expected, `${name} queues its authored number of primary NPC hits`);
    assert(hits.some(hit => hit.lastInt > 0), `${name} produces its effect on the primary NPC`);
}
function assertPvpSpecialEffect(name, target, before) {
    if (stunWeapons.has(name)) {
        assert(isSpearPushQueued(target) || (target.delayed && target.delayedUntil > World.currentTick)
            || variable(target, 'action_delay') > World.currentTick
            || target.x !== before.x || target.z !== before.z,
            `${name} applies its real player shove/stun effect without a damage queue`);
        return;
    }
    const hits = playerHits(target);
    const expected = doubleHitWeapons.has(name) ? 2 : 1;
    assert.equal(hits.length, expected, `${name} queues its authored number of primary player hits`);
    assert(hits.some(hit => Number.isInteger(hit.args[0]) && hit.args[0] > 0),
        `${name} produces its effect on the primary player`);
}
function test(name, action) {
    action();
    console.log(`PASS ${name}`);
}

for (const item of specialWeapons) {
    const name = itemName(item);
    for (const mode of ['pvm', 'pvp']) {
        test(`${name} native ${mode} special or immediate effect never stalls`, () => {
            const f = fixture(item);
            try {
                let executions;
                let target;
                const tick = World.currentTick;
                if (rodCharges.has(name)) {
                    f.p.setVarBit(id('VarBitType', 'myreque_2_quest'), 421);
                    pressSpecial(f.p);
                    assert.equal(variable(f.p, 'sa_attack'), 1, `${name} native combat-tab button enables capture`);
                    if (mode === 'pvm') {
                        target = npc(f, types.NpcType.get(id('NpcType', 'burgh_vampire_juvenile_1')));
                        target.levels[PlayerStat.HITPOINTS] = Math.floor(target.baseLevels[PlayerStat.HITPOINTS] / 4);
                        executions = attackNpc(f, target);
                        assertHandler(executions, pvmHandler[name]);
                        assertCostAndConsumed(f, item);
                        assert.equal(target.type, id('NpcType', 'burgh_vampire_juvenile_held'),
                            `${name} captures the eligible quarter-health juvenile`);
                        assert.equal(npcHits(target).length, 0, `${name} capture queues no ordinary damage`);
                        const charges = rodCharges.get(name);
                        if (charges === 1) {
                            assert.equal(f.p.getInventory(worn).get(rightHand), null, 'the last charge leaves no worn dust');
                            assert.equal(f.p.invTotal(inventory, id('ObjType', 'burgh_rod_command_dust')), 1,
                                'the last charge gives recoverable dust');
                        } else {
                            assert.equal(f.p.getInventory(worn).get(rightHand)?.id,
                                id('ObjType', `burgh_rod_command_final_${charges - 1}`), 'capture spends exactly one rod charge');
                        }
                    } else {
                        target = player(f, f.p.x + 1, f.p.z);
                        executions = attackPlayer(f, target);
                        assertHandler(executions, pvpHandler[name]);
                        assert.equal(variable(f.p, 'sa_energy'), 1000, `${name} ordinary PvP fallback spends no special energy`);
                        assert.equal(variable(f.p, 'sa_attack'), 0, `${name} ordinary PvP fallback clears the toggle`);
                        assert.equal(f.p.getInventory(worn).get(rightHand)?.id, item.id, 'PvP spends no rod charge');
                        assert.equal(playerHits(target).length, 1, `${name} PvP fallback queues exactly one ordinary hit`);
                        assert(playerHits(target)[0].args[0] > 0, `${name} ordinary PvP hit deals damage`);
                    }
                } else if (directEffects.has(name)) {
                    const oldAttack = f.p.levels[PlayerStat.ATTACK];
                    const oldDefence = f.p.levels[PlayerStat.DEFENCE];
                    const oldStrength = f.p.levels[PlayerStat.STRENGTH];
                    pressSpecial(f.p);
                    assert.equal(variable(f.p, 'sa_energy'), 1000 - expectedCost.get(name),
                        `${name} immediate button effect spends its authored cost once`);
                    assert.equal(variable(f.p, 'sa_attack'), 0, `${name} immediate effect does not leave the toggle enabled`);
                    if (name === 'excalibur') {
                        assert(f.p.levels[PlayerStat.DEFENCE] > oldDefence, 'Excalibur boosts Defence immediately');
                    } else {
                        assert(f.p.levels[PlayerStat.ATTACK] < oldAttack, 'dragon battleaxe drains Attack immediately');
                        assert(f.p.levels[PlayerStat.STRENGTH] > oldStrength, 'dragon battleaxe boosts Strength immediately');
                    }
                    run(f.p, '[proc,player_combat_stat]');
                    target = mode === 'pvm' ? npc(f) : player(f, f.p.x + 1, f.p.z);
                    if (mode === 'pvm') executions = attackNpc(f, target);
                    else executions = attackPlayer(f, target);
                    assert.equal(variable(f.p, 'sa_energy'), 1000 - expectedCost.get(name),
                        `${name} ordinary follow-up attack spends no second cost`);
                    assert.equal(variable(f.p, 'sa_attack'), 0, `${name} ordinary follow-up remains un-specialized`);
                    if (mode === 'pvm') {
                        assert.equal(npcHits(target).length, 1, `${name} follows the immediate button effect with one ordinary NPC hit`);
                        assert(npcHits(target)[0].lastInt > 0, `${name} ordinary NPC follow-up hits`);
                    } else {
                        assert.equal(playerHits(target).length, 1, `${name} follows the immediate button effect with one ordinary player hit`);
                        assert(playerHits(target)[0].args[0] > 0, `${name} ordinary player follow-up hits`);
                    }
                } else {
                    if (name === 'granite_maul') variable(f.p, 'action_delay', tick + (mode === 'pvp' ? 2 : 0));
                    pressSpecial(f.p);
                    assert.equal(variable(f.p, 'sa_attack'), 1, `${name} native combat-tab button enables the special`);
                    target = mode === 'pvm' ? npc(f) : player(f, f.p.x + 1, f.p.z);
                    const before = { x: target.x, z: target.z };
                    const dagger = name === 'dragon_dagger' || name === 'dragon_dagger_p';
                    executions = mode === 'pvm'
                        ? attackNpc(f, target, undefined, dagger ? [State.SUSPENDED] : stunWeapons.has(name) ? [State.NPC_SUSPENDED] : [])
                        : attackPlayer(f, target, undefined, dagger || stunWeapons.has(name) ? [State.SUSPENDED] : []);
                    assert.equal(World.currentTick, tick, `${name} begins its special in the triggering tick`);
                    if (dagger) {
                        const continuation = f.p.activeScript;
                        assert.equal(continuation?.execution, State.SUSPENDED, 'published dagger pauses between its two hits');
                        assert.equal(f.p.delayedUntil, tick + 1, 'p_delay(0) resumes the dagger on the next tick');
                        World.currentTick++;
                        f.p.delayed = false;
                        executions.push(...observe(f, () => f.p.executeScript(continuation, true, true)));
                        assert.equal(f.p.activeScript, null, 'the second dagger hit completes its native continuation');
                    }
                    assertCostAndConsumed(f, item);
                    assertHandler(executions, mode === 'pvm' ? pvmHandler[name] : pvpHandler[name]);
                    if (mode === 'pvm') assertNpcSpecialEffect(name, target);
                    else assertPvpSpecialEffect(name, target, before);
                    if (name === 'granite_maul' && mode === 'pvp') {
                        assert.equal(variable(f.p, 'action_delay'), tick + 7,
                            'granite maul early jump still lands through an existing action delay');
                    }
                }
                assert.equal(World.currentTick, tick + (name === 'dragon_dagger' || name === 'dragon_dagger_p' ? 1 : 0),
                    `${name} completes within its authored same-tick or one-tick timing`);
                assertHealthy(f, `${name} ${mode}`);
            } finally { dispose(f); }
        });
    }
}

for (const item of specialWeapons) {
    const name = itemName(item);
    if (!rodCharges.has(name)) continue;
    test(`${name} native capture refuses incomplete quests and unsupported creatures without spending`, () => {
        for (const [stage, targetName] of [[400, 'burgh_vampire_juvenile_1'], [421, 'goblin']]) {
            const f = fixture(item);
            try {
                f.p.setVarBit(id('VarBitType', 'myreque_2_quest'), stage);
                const target = npc(f, types.NpcType.get(id('NpcType', targetName)));
                const original = target.type;
                target.levels[PlayerStat.HITPOINTS] = Math.floor(target.baseLevels[PlayerStat.HITPOINTS] / 4);
                pressSpecial(f.p);
                assert.equal(variable(f.p, 'sa_attack'), 1, 'native special button enables the attempted capture');
                const executions = attackNpc(f, target);
                assertHandler(executions, pvmHandler[name]);
                assert.equal(target.type, original, 'refused capture does not transform the creature');
                assert.equal(variable(f.p, 'sa_energy'), 1000, 'refused capture spends no special energy');
                assert.equal(variable(f.p, 'sa_attack'), 0, 'refused capture clears the toggle');
                assert.equal(f.p.getInventory(worn).get(rightHand)?.id, item.id, 'refused capture spends no rod charge');
                assert.equal(npcHits(target).length, 0, 'refused capture queues no ordinary damage');
            } finally { dispose(f); }
        }
    });
}

test('unmatched special-enabled melee weapon falls through to one ordinary hit in both modes', () => {
    const ordinary = types.ObjType.getByName('bronze_longsword');
    assert(ordinary && ordinary.wearpos === rightHand, 'ordinary bronze longsword is a real right-hand melee fixture');
    assert.notEqual(param(ordinary, 'specwep'), 1, 'synthetic witness begins without a special bar');
    withParam(ordinary, 'specwep', 1, () => {
        for (const mode of ['pvm', 'pvp']) {
            const f = fixture(ordinary);
            try {
                pressSpecial(f.p);
                assert.equal(variable(f.p, 'sa_attack'), 1, 'synthetic bar turns on through the real tab button');
                const target = mode === 'pvm' ? npc(f) : player(f, f.p.x + 1, f.p.z);
                const tick = World.currentTick;
                const executions = mode === 'pvm' ? attackNpc(f, target) : attackPlayer(f, target);
                assert.equal(variable(f.p, 'sa_energy'), 1000, 'unmatched fallback spends no special energy');
                assert.equal(variable(f.p, 'sa_attack'), 0, 'unmatched fallback consumes the toggle');
                assert(!executions.some(state => state.script?.name === '[label,pvm_dragon_scimitar_sa]'
                    || state.script?.name === '[label,pvp_dragon_scimitar_sa]'), 'synthetic ordinary weapon reaches no special handler');
                const hits = mode === 'pvm' ? npcHits(target) : playerHits(target);
                assert.equal(hits.length, 1, `unmatched ${mode} attack produces exactly one ordinary hit in the triggering tick`);
                if (mode === 'pvm') {
                    assert.equal(hits[0].delay, 0, 'ordinary NPC hit has no extra tick delay');
                    assert(hits[0].lastInt > 0, 'ordinary NPC hit deals damage');
                } else {
                    assert.equal(hits[0].delay, 0, 'ordinary player hit has no extra tick delay');
                    assert(hits[0].args[0] > 0, 'ordinary player hit deals damage');
                }
                assert.equal(variable(f.p, 'action_delay'), tick + param(ordinary, 'attackrate'),
                    'ordinary attack delay is the packed weapon rate');
                assert.equal(World.currentTick, tick, 'fallback does not advance the world tick');
                assertHealthy(f, `unmatched ${mode} special`);
            } finally { dispose(f); }
        }
    });
});

test('poisoned dagger and spear PvP variants enter the compiled shared dispatch only', () => {
    const witnesses = [
        ['dragon_dagger_p+', 'pvp_dragon_dagger_sa'], ['dragon_dagger_p++', 'pvp_dragon_dagger_sa'],
        ['dragon_spear_p+', 'pvp_dragon_spear_sa'], ['dragon_spear_p++', 'pvp_dragon_spear_sa'],
        ['tbwt_dragon_spear_kp', 'pvp_dragon_spear_sa']
    ];
    for (const [name, handler] of witnesses) {
        const item = types.ObjType.getByName(name);
        assert(item && item.wearpos === rightHand, `${name} is a packed right-hand variant`);
        withParam(item, 'specwep', 1, () => {
            const f = fixture(item, { combatData: false });
            try {
                // Bare variants have no combat rows or real special-bar button: seed only the synthetic dispatch toggle.
                variable(f.p, 'sa_attack', 1);
                variable(f.p, 'damagetype', damageType.slash);
                variable(f.p, 'damagestyle', 0);
                variable(f.p, 'com_maxhit', 20);
                for (const style of ['stab', 'slash', 'crush', 'range', 'magic']) {
                    variable(f.p, `com_${style}attack`, 1000000);
                }
                const target = player(f, f.p.x + 1, f.p.z);
                const executions = attackPlayer(f, target, undefined, [State.SUSPENDED]);
                assertHandler(executions, handler);
                assertHealthy(f, `${name} compiled PvP route`);
            } finally { dispose(f); }
        });
    }
});

test('rune claws PvM keeps ordinary accuracy, 110% maximum damage and the extra delay tick', () => {
    const claws = types.ObjType.getByName('rune_claws');
    assert(claws, 'rune claws exist');
    const f = fixture(claws);
    try {
        chooseMode(f.p, damageType.slash);
        variable(f.p, 'com_maxhit', 20);
        const target = npc(f);
        target.levels[PlayerStat.DEFENCE] = target.baseLevels[PlayerStat.DEFENCE] = 99;
        const defenceRoll = procInt(f.p, '[proc,npc_defence_roll_specific]', [damageType.slash], target);
        const ordinaryAttackRoll = boundaryAttack(defenceRoll, 110);
        variable(f.p, 'com_slashattack', ordinaryAttackRoll);
        pressSpecial(f.p);
        const tick = World.currentTick;
        const miss = attackNpc(f, target, [0.9, 0.9, 0.999999]);
        assertCostAndConsumed(f, claws);
        assertHandler(miss, pvmHandler.rune_claws);
        assert.equal(npcHits(target).length, 1, 'miss remains a real special-handler queue, not a stall');
        assert.equal(npcHits(target)[0].lastInt, 0,
            'equal-quantile roll between ordinary and 110%-boosted accuracy misses without a claw accuracy bonus');
        assert.equal(variable(f.p, 'action_delay'), tick + param(claws, 'attackrate') + 1,
            'PvM rune claws keeps its extra action-delay tick');
        assertHealthy(f, 'rune claws ordinary-accuracy boundary');
    } finally { dispose(f); }

    const hitFixture = fixture(claws);
    try {
        chooseMode(hitFixture.p, damageType.slash);
        variable(hitFixture.p, 'com_maxhit', 20);
        setAttackRolls(hitFixture.p, 1000000);
        const target = npc(hitFixture);
        pressSpecial(hitFixture.p);
        const tick = World.currentTick;
        const executions = attackNpc(hitFixture, target, [0.999999, 0, 0.999999]);
        assertCostAndConsumed(hitFixture, claws);
        assertHandler(executions, pvmHandler.rune_claws);
        assert.deepEqual(npcHits(target).map(hit => hit.lastInt), [22], '20 normal maximum hit scales to exactly 22');
        assert.equal(variable(hitFixture.p, 'action_delay'), tick + param(claws, 'attackrate') + 1,
            'the successful PvM claw hit preserves the extra delay tick');
    } finally { dispose(hitFixture); }
});

test('abyssal whip PvP uses 125% accuracy and transfers exactly 10% of current run energy', () => {
    const whip = types.ObjType.getByName('abyssal_whip');
    assert(whip, 'abyssal whip exists');
    const f = fixture(whip);
    try {
        const target = player(f, f.p.x + 1, f.p.z);
        variable(f.p, 'com_slashattack', 1000);
        variable(target, 'com_slashdef', 1100);
        f.p.runenergy = 5000;
        target.runenergy = 7430;
        pressSpecial(f.p);
        const executions = attackPlayer(f, target, [0.9, 0.9, 0.999999]);
        assertCostAndConsumed(f, whip);
        assertHandler(executions, pvpHandler.abyssal_whip);
        assert.deepEqual(playerHits(target).map(hit => hit.args[0]), [20],
            'the 125%-accuracy boundary lands one ordinary-maxhit whip special');
        assert.equal(f.p.runenergy, 5743, 'attacker receives 10% of the target current run energy');
        assert.equal(target.runenergy, 6687, 'target loses that same 10% current run energy');
        assertHealthy(f, 'abyssal whip PvP accuracy and transfer');
    } finally { dispose(f); }
});

test('dragon scimitar PvM uses 125% accuracy, normal maxhit and remaining-hitpoint XP cap', () => {
    const scimitar = types.ObjType.getByName('dragon_scimitar');
    assert(scimitar, 'dragon scimitar exists');
    const accuracyFixture = fixture(scimitar);
    try {
        chooseMode(accuracyFixture.p, damageType.slash);
        variable(accuracyFixture.p, 'com_maxhit', 20);
        const target = npc(accuracyFixture);
        target.levels[PlayerStat.DEFENCE] = target.baseLevels[PlayerStat.DEFENCE] = 99;
        const defenceRoll = procInt(accuracyFixture.p, '[proc,npc_defence_roll_specific]', [damageType.slash], target);
        variable(accuracyFixture.p, 'com_slashattack', boundaryAttack(defenceRoll, 125));
        pressSpecial(accuracyFixture.p);
        const executions = attackNpc(accuracyFixture, target, [0.9, 0.9, 0.999999]);
        assertCostAndConsumed(accuracyFixture, scimitar);
        assertHandler(executions, pvmHandler.dragon_scimitar);
        assert.deepEqual(npcHits(target).map(hit => hit.lastInt), [20],
            'the special improves accuracy once and leaves the normal 20 maximum hit unchanged');
    } finally { dispose(accuracyFixture); }

    const xpFixture = fixture(scimitar);
    try {
        chooseMode(xpFixture.p, null, 1); // Aggressive mode: 4 Strength XP per damage.
        variable(xpFixture.p, 'com_maxhit', 20);
        setAttackRolls(xpFixture.p, 1000000);
        const target = npc(xpFixture);
        target.levels[PlayerStat.HITPOINTS] = target.baseLevels[PlayerStat.HITPOINTS] = 8;
        pressSpecial(xpFixture.p);
        const executions = attackNpc(xpFixture, target, [0.999999, 0, 0.999999]);
        assertCostAndConsumed(xpFixture, scimitar);
        assertHandler(executions, pvmHandler.dragon_scimitar);
        assert.deepEqual(npcHits(target).map(hit => hit.lastInt), [20], 'queued scimitar damage is not HP-truncated');
        assert.equal(xpFixture.p.stats[PlayerStat.STRENGTH] - level99Experience, 320,
            '8 remaining hitpoints award exactly 8 x 4 x 10 internal Strength XP');
    } finally { dispose(xpFixture); }
});

test('dragon scimitar honours npc_max_dealt and the primary NPC admission gate', () => {
    const scimitar = types.ObjType.getByName('dragon_scimitar');
    const capType = types.NpcType.configs.find(type => type?.name === 'Salarin the twisted' && type.op?.[1] === 'Attack');
    assert(capType, 'packed Salarin exposes its native Attack option');
    assert.equal(param(capType, 'max_dealt'), 0, 'packed Salarin has an authored zero max_dealt cap');
    const f = fixture(scimitar);
    try {
        const target = npc(f, capType);
        pressSpecial(f.p);
        const executions = attackNpc(f, target, [0.999999, 0, 0.999999]);
        assertCostAndConsumed(f, scimitar);
        assertHandler(executions, pvmHandler.dragon_scimitar);
        assert.deepEqual(npcHits(target).map(hit => hit.lastInt), [0],
            'the special uses npc_max_dealt before queuing damage');
        assert.equal(f.p.stats[PlayerStat.STRENGTH], level99Experience, 'zero max_dealt awards no combat XP');
    } finally { dispose(f); }

    const refused = fixture(scimitar);
    try {
        const kuraskType = types.NpcType.configs.find(type => type?.name === 'Kurask' && type.op?.[1] === 'Attack');
        assert(kuraskType, 'packed Kurask exposes its Attack option');
        const target = npc(refused, kuraskType);
        refused.p.levels[18] = 1;
        pressSpecial(refused.p);
        const executions = attackNpc(refused, target);
        assert.equal(variable(refused.p, 'sa_energy'), 1000, 'primary Slayer admission rejects before special cost');
        assert.equal(npcHits(target).length, 0, 'a refused primary receives no special or ordinary hit');
        assert(!executions.some(state => state.script?.name === `[label,${pvmHandler.dragon_scimitar}]`),
            'the special cannot bypass the primary-target check');
    } finally { dispose(refused); }
});

test('dragon scimitar locks only the primary player protections, including a successful zero-damage roll', () => {
    const scimitar = types.ObjType.getByName('dragon_scimitar');
    const f = fixture(scimitar);
    try {
        const primary = player(f, f.p.x + 1, f.p.z);
        const bystander = player(f, f.p.x + 2, f.p.z);
        activatePrayer(primary, 'prayer_protectfrommelee');
        activatePrayer(bystander, 'prayer_protectfrommelee');
        variable(f.p, 'com_slashattack', 1000000);
        variable(primary, 'com_slashdef', 0);
        variable(f.p, 'com_maxhit', 0);
        primary.delayed = true; // Busy victim fixture: incoming Sever must not need protected access.
        primary.delayedUntil = World.currentTick + 100;
        pressSpecial(f.p);
        const firstTick = World.currentTick;
        const first = attackPlayer(f, primary, [0.999999, 0, 0.999999]);
        assertCostAndConsumed(f, scimitar);
        assertHandler(first, pvpHandler.dragon_scimitar);
        assert.deepEqual(playerHits(primary).map(hit => hit.args[0]), [0],
            'a successful accuracy roll with zero damage still queues the real primary hit');
        assert.equal(variable(primary, 'prayer14'), 0, 'successful Sever deactivates the primary active melee protection');
        assert.equal(variable(bystander, 'prayer14'), 1, 'the special does not deactivate a nearby bystander prayer');
        assert.equal(primary.timers.get(prayerLockId)?.clock, firstTick, 'the primary receives its own normal timer');
        assert.equal(bystander.timers.has(prayerLockId), false, 'the bystander receives no lock timer');

        const rate = param(scimitar, 'attackrate');
        assert(rate > 0 && rate < 8, 'packed scimitar permits a second successful special inside the 8-tick lock window');
        World.currentTick = firstTick + rate;
        variable(f.p, 'sa_energy', 1000); // labelled own-state energy seed for a second special.
        pressSpecial(f.p);
        const second = attackPlayer(f, primary, [0.999999, 0, 0.999999]);
        assertCostAndConsumed(f, scimitar);
        assertHandler(second, pvpHandler.dragon_scimitar);
        assert.equal(primary.timers.get(prayerLockId)?.clock, World.currentTick,
            'a second successful special restarts the lock timer at its hit tick');
        const unrelatedTimer = Provider.getByName('[timer,stat_regen]');
        assert(unrelatedTimer, 'compiled unrelated normal timer is available as a survivor');
        primary.setTimer(PlayerTimerType.NORMAL, unrelatedTimer, [], 1000);

        World.currentTick += 7;
        primary.processTimers(PlayerTimerType.NORMAL);
        assert.equal(primary.timers.get(prayerLockId)?.clock, firstTick + rate,
            'a victim busy through the window retains the restarted timer clock');
        primary.delayed = false; // Allow native prayer-button probes without advancing the clock.
        for (const prayerName of ['prayer_protectfrommelee', 'prayer_protectfrommissiles', 'prayer_protectfrommagic']) {
            const stateName = prayerVarFor(prayerName);
            const messagesBefore = primary.messages.length;
            const packetsBefore = primary.packets.length;
            pressButton(primary, `prayer:${prayerName}`);
            assert.equal(variable(primary, stateName), 0, `${prayerName} remains off during the 8-tick lock`);
            assert.equal(primary.messages.length, messagesBefore, `${prayerName} refusal adds no invented text`);
            const refusalSounds = primary.packets.slice(packetsBefore)
                .filter(packet => packet instanceof SynthSound && packet.synth === prayerOffSynth);
            assert.equal(refusalSounds.length, 1, `${prayerName} refusal emits the existing prayer_off sound`);
        }
        activatePrayer(primary, 'prayer_thickskin');
        assert.equal(variable(primary, 'prayer0'), 1, 'non-protection prayer remains available during Sever');

        World.currentTick++;
        assert.equal(World.currentTick, primary.timers.get(prayerLockId).clock + 8,
            'the protection lock reaches its exact eight-tick expiry');
        primary.delayed = true; // Own-player fixture seed: defer the normal timer callback as a busy player would.
        primary.delayedUntil = World.currentTick + 1;
        primary.processTimers(PlayerTimerType.NORMAL);
        assert(primary.timers.has(prayerLockId), 'busy normal timer callback remains pending');
        primary.delayed = false;
        activatePrayer(primary, 'prayer_protectfrommagic');
        assert.equal(variable(primary, 'prayer12'), 1, 'protection prayer can activate on the exact expiry tick while its callback was deferred');
        primary.processTimers(PlayerTimerType.NORMAL);
        assert.equal(primary.timers.has(prayerLockId), false, 'normal timer callback clears its own lock once the player is available');
        assert(primary.timers.has(unrelatedTimer.id), 'scimitar timer callback preserves unrelated normal timers');
        assertHealthy(f, 'dragon scimitar protection lock');
    } finally { dispose(f); }
});

test('dragon scimitar normal callback releases protection on exactly the eighth tick', () => {
    const scimitar = types.ObjType.getByName('dragon_scimitar');
    const f = fixture(scimitar);
    try {
        const target = player(f, f.p.x + 1, f.p.z);
        pressSpecial(f.p);
        const tick = World.currentTick;
        const executions = attackPlayer(f, target, [0.999999, 0, 0.999999]);
        assertHandler(executions, pvpHandler.dragon_scimitar);
        assertCostAndConsumed(f, scimitar);
        World.currentTick = tick + 7;
        target.processTimers(PlayerTimerType.NORMAL);
        pressButton(target, 'prayer:prayer_protectfrommelee');
        assert.equal(variable(target, 'prayer14'), 0, 'the seventh tick remains locked without a busy victim');
        assert(target.timers.has(prayerLockId), 'the normal callback has not fired early');
        World.currentTick = tick + 8;
        target.processTimers(PlayerTimerType.NORMAL);
        assert.equal(target.timers.has(prayerLockId), false, 'the eighth-tick callback clears its own timer');
        activatePrayer(target, 'prayer_protectfrommelee');
        assertHealthy(f, 'normal eighth-tick prayer expiry');
    } finally { dispose(f); }
});

test('dragon scimitar death cleanup clears its normal prayer-lock timer', () => {
    const scimitar = types.ObjType.getByName('dragon_scimitar');
    const f = fixture(scimitar);
    try {
        const target = player(f, f.p.x + 1, f.p.z);
        variable(f.p, 'com_slashattack', 1000000);
        variable(target, 'com_slashdef', 0);
        pressSpecial(f.p);
        const executions = attackPlayer(f, target, [0.999999, 0, 0.999999]);
        assertCostAndConsumed(f, scimitar);
        assertHandler(executions, pvpHandler.dragon_scimitar);
        assert(target.timers.has(prayerLockId), 'successful scimitar special starts the target timer');
        run(target, '[proc,combat_clearqueue]');
        assert.equal(target.timers.has(prayerLockId), false, 'death combat cleanup clears the prayer-lock timer');
    } finally { dispose(f); }
});

console.log('special-routes: all compiled contracts passed');
process.exit(0); // World imports maintenance timers; this offline process owns no live server.
