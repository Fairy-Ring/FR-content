#!/usr/bin/env node
/** Exercise every packed right-hand combat style through the native player/NPC attack path. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(here, '../../../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const SynthSound = (await load('src/network/game/server/model/SynthSound.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
Environment.NODE_PRODUCTION = true;
Environment.NODE_DEBUG_PROFILE = false;

const configs = {};
for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType',
    'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType',
    'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType'
]) {
    configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
    configs[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'load a real compiled pack');
const { VarPlayerType, VarNpcType, NpcType, ObjType, InvType, CategoryType, ParamType, Component } = configs;
const id = (type, name) => {
    const value = type.getId(name);
    assert(value >= 0, `missing packed ${name}`);
    return value;
};
const param = name => {
    const value = ParamType.getByName(name);
    assert(value, `missing packed parameter ${name}`);
    return value;
};
const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');
const intParam = (type, value) => ParamHelper.getIntParam(value.id, type, value.defaultInt);

const worn = id(InvType, 'worn');
const inventory = id(InvType, 'inv');
const rightHand = ObjType.getWearPosId('righthand');
const quiver = ObjType.getWearPosId('quiver');
assert(rightHand >= 0 && quiver >= 0, 'packed right-hand and quiver slots exist');
const varIds = {
    combatMode: id(VarPlayerType, 'com_mode'),
    damageType: id(VarPlayerType, 'damagetype'),
    damageStyle: id(VarPlayerType, 'damagestyle'),
    attackAnim: id(VarPlayerType, 'com_attackanim'),
    attackSound: id(VarPlayerType, 'com_attacksound'),
    actionDelay: id(VarPlayerType, 'action_delay'),
    npcAggressivePlayer: id(VarNpcType, 'npc_aggressive_player')
};
const attackRate = param('attackrate');
const levelRequirement = param('levelrequire');
const defendSound = param('defend_sound');
const manType = NpcType.getByName('man');
assert(manType, 'packed Man NPC is available as an ordinary attack target');
const targetDefendSound = intParam(manType, defendSound);
assert.equal(manType.op?.[1]?.toLowerCase(), 'attack', 'Man exposes the native Attack option');

// These are script constants, not generated pack ids.
const damageType = { stab: 0, slash: 1, crush: 2, ranged: 3 };
const damageStyle = { accurate: 0, aggressive: 1, defensive: 2, controlled: 3, rangedRapid: 5 };
const attackParams = {
    [damageType.stab]: ['stabattack_anim', 'stab_sound'],
    [damageType.slash]: ['slashattack_anim', 'slash_sound'],
    [damageType.crush]: ['crushattack_anim', 'crush_sound']
};
const categoryIds = {
    polearm: id(CategoryType, 'weapon_polearm'),
    blunt: id(CategoryType, 'weapon_blunt'),
    bow: id(CategoryType, 'weapon_bow'),
    crossbow: id(CategoryType, 'weapon_crossbow'),
    thrown: id(CategoryType, 'weapon_thrown'),
    javelin: id(CategoryType, 'weapon_javelin'),
    arrows: id(CategoryType, 'arrows'),
    bolts: id(CategoryType, 'bolts'),
    ogreArrows: id(CategoryType, 'ogre_arrows')
};
const quiverObjects = ObjType.configs.filter(type => type && type.wearpos === quiver);
const nameByObjectId = new Map([...ObjType.configNames].map(([name, objectId]) => [objectId, name]));
const itemName = type => nameByObjectId.get(type.id) ?? type.name ?? `packed object ${type.id}`;
const hasWieldOrWear = type => [...(type.op ?? []), ...(type.iop ?? [])]
    .some(option => typeof option === 'string' && ['wield', 'wear'].includes(option.trim().toLowerCase()));
const weapons = ObjType.configs.filter(type => type && type.wearpos === rightHand && hasWieldOrWear(type));
assert(weapons.length > 0, 'packed item configs include right-hand Wield/Wear options');
// Greegrees expose Hold, not Wield/Wear: add them as the separate guard-class witness.
const heldGuards = ObjType.configs.filter(type => type && type.wearpos === rightHand
    && /greegree/i.test(itemName(type)) && (type.iop ?? []).some(option => option?.toLowerCase() === 'hold'));
const attackItems = [...new Map([...weapons, ...heldGuards].map(type => [type.id, type])).values()];

function ammoFor(type) {
    if (type.category !== categoryIds.bow && type.category !== categoryIds.crossbow) return null;
    const ammoCategory = type.category === categoryIds.crossbow
        ? categoryIds.bolts
        : type.id === id(ObjType, 'ogre_bow') ? categoryIds.ogreArrows : categoryIds.arrows;
    const weaponLevel = intParam(type, levelRequirement);
    const ammo = quiverObjects.find(candidate => candidate.category === ammoCategory
        && intParam(candidate, levelRequirement) <= weaponLevel);
    assert(ammo, `${itemName(type)} has compatible packed quiver ammunition`);
    return ammo;
}

World.currentTick = 100;
World.gameMap.init();
const player = new Player('weapon-sounds-census', 1001n, 100001n);
player.slot = 1;
player.pid = 1;
player.uid = (1001 << 11) | 1;
player.x = 3500;
player.z = 3500;
player.level = 0;
player.isActive = true;
for (const stat of [PlayerStat.ATTACK, PlayerStat.DEFENCE, PlayerStat.STRENGTH,
    PlayerStat.HITPOINTS, PlayerStat.RANGED, PlayerStat.MAGIC]) {
    player.baseLevels[stat] = 99;
    player.levels[stat] = 99;
}
player.stats.fill(0);
const playerVarDefaults = player.vars.slice();
player.getInventory(worn);
player.getInventory(inventory);
player.testMessages = [];
player.logoutCalls = 0;
player.write = packet => player.testMessages.push(packet);
player.messageGame = text => player.testMessages.push({ text: String(text) });
player.wrappedMessageGame = player.messageGame;
player.logout = () => { player.logoutCalls++; };
World.players[player.slot] = player;
World.playerLoop.add(player.hash64, player);

const target = new Npc(0, player.x + 1, player.z, manType.size, manType.size,
    EntityLifeCycle.DESPAWN, World.getNextNid(), manType.id, manType.blockwalk);
World.addNpc(target, -1);
target.lastMovement = -100;
const targetVarDefaults = target.vars.slice();

function currentStyle() {
    return {
        mode: player.getVar(varIds.combatMode),
        damageType: player.getVar(varIds.damageType),
        damageStyle: player.getVar(varIds.damageStyle),
        attackAnim: player.getVar(varIds.attackAnim),
        attackSound: player.getVar(varIds.attackSound)
    };
}

function assertHealthy(context) {
    const errors = player.testMessages.filter(message =>
        typeof message?.text === 'string' && /script error/i.test(message.text));
    assert.equal(errors.length, 0, `${context} produced no script error`);
    assert.equal(player.logoutCalls, 0, `${context} did not log out the player`);
}

function runScript(name, args = []) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing packed script ${name}`);
    const state = ScriptRunner.init(script, player, null, args);
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    player.executeScript(state, true, true);
    assert.equal(state.execution, ScriptState.FINISHED, `${name} must finish`);
    assertHealthy(name);
    return state;
}

function resetPlayer(type, mode = 0) {
    player.clearInteraction();
    player.vars.set(playerVarDefaults);
    player.stats.fill(0);
    player.baseLevels.fill(99);
    player.levels.fill(99);
    player.getInventory(inventory).removeAll();
    player.getInventory(worn).removeAll();
    player.testMessages.length = 0;
    player.logoutCalls = 0;
    player.tabs.length = 0;
    player.setVar(varIds.combatMode, mode);
    if (!type) return;

    const count = type.category === categoryIds.thrown || type.category === categoryIds.javelin ? 3 : 1;
    player.getInventory(worn).set(rightHand, { id: type.id, count });
    const ammo = ammoFor(type);
    if (ammo) player.getInventory(worn).set(quiver, { id: ammo.id, count: 10 });
}

function resetTarget() {
    target.queue.clear();
    target.vars.set(targetVarDefaults);
    target.setVar(varIds.npcAggressivePlayer, player.uid);
    target.lastMovement = -100;
}

function discoverStyles(type) {
    resetPlayer(type);
    const rows = [];
    for (let requestedMode = 0; requestedMode < 4; requestedMode++) {
        player.setVar(varIds.combatMode, requestedMode);
        runScript('[proc,player_combat_stat]');
        const row = currentStyle();
        if (row.mode !== requestedMode) continue;
        rows.push(row);
    }
    assert(rows.length > 0, `${itemName(type)} has at least one packed combat style`);
    assert.deepEqual(rows.map(row => row.mode), rows.map((_, index) => index),
        `${itemName(type)} exposes contiguous selectable modes`);
    return rows;
}

function componentText(name) {
    const component = Component.getByName(name);
    assert(component, `missing packed component ${name}`);
    return component.text;
}

function verifyStyleTab(spec, type, rows) {
    const tab = Component.getByName(spec.tab);
    assert(tab, `missing packed combat tab ${spec.tab}`);
    assert.equal(type.category, spec.category, `${spec.item} has the expected packed weapon family`);
    resetPlayer(type);
    runScript('[proc,update_weapon_category]', [type.id]);
    assert(player.tabs.includes(tab.id), `${spec.item} opens ${spec.tab}`);

    for (const expected of spec.styles) {
        const row = rows.find(candidate => candidate.mode === expected.mode);
        assert(row, `${spec.item} exposes ${expected.name}`);
        assert.equal(row.damageType, expected.damageType, `${spec.item} ${expected.name} damage type`);
        assert.equal(row.damageStyle, expected.damageStyle, `${spec.item} ${expected.name} stance`);
        assert.equal(componentText(`${spec.tab}:${expected.nameComponent}`), expected.name,
            `${spec.item} displays ${expected.name}`);
        assert.equal(componentText(`${spec.tab}:${expected.stanceComponent}`), expected.stance,
            `${spec.item} displays ${expected.stance}`);
        assert.equal(componentText(`${spec.tab}:${expected.damageComponent}`), expected.damage,
            `${spec.item} displays ${expected.damage}`);

        const button = Component.getByName(`${spec.tab}:${expected.button}`);
        assert(button, `${spec.item} has packed ${expected.name} button`);
        assert.equal(button.buttonType, Component.SELECT_BUTTON,
            `${spec.item} ${expected.name} is a selectable combat button`);
        runScript(`[if_button,${spec.tab}:${expected.button}]`);
        assert.deepEqual(currentStyle(), row, `${spec.item} ${expected.name} button selects its packed style`);

        const params = attackParams[row.damageType];
        assert(params, `${spec.item} ${expected.name} has a melee animation/sound parameter family`);
        assert.equal(row.attackAnim, intParam(type, param(params[0])),
            `${spec.item} ${expected.name} selects its attack animation`);
        assert.equal(row.attackSound, intParam(type, param(params[1])),
            `${spec.item} ${expected.name} selects its attack sound`);
        assert.notEqual(row.attackAnim, -1, `${spec.item} ${expected.name} has a packed attack animation`);
        assert.notEqual(row.attackSound, -1, `${spec.item} ${expected.name} has a packed attack sound`);
    }
}

function queuedAttacks() {
    return [...target.queue.all()].filter(request => request.queueId === ServerTriggerType.AI_QUEUE2);
}

function assertSoundSince(start, style, context) {
    const sounds = player.testMessages.slice(start).filter(message => message instanceof SynthSound);
    const expected = style.attackSound === -1 ? [] : [style.attackSound];
    if (targetDefendSound !== -1) expected.push(targetDefendSound);
    assert.deepEqual(sounds.map(message => message.synth), expected,
        `${context} emits only its non-null attack sound and the target's defend sound`);
}

function expectedNextAttack(type, style, tick) {
    const rapid = style.damageType === damageType.ranged && style.damageStyle === damageStyle.rangedRapid ? 1 : 0;
    return tick + intParam(type, attackRate) - rapid;
}

function assertNativeAttack(type, style) {
    const context = `${itemName(type)} mode ${style.mode}`;
    resetPlayer(type, style.mode);
    runScript('[proc,player_combat_stat]');
    assert.deepEqual(currentStyle(), style, `${context} uses its discovered packed style`);
    resetTarget();
    const targetHitpoints = target.levels[NpcStat.HITPOINTS];
    const firstTick = World.currentTick + 1;
    assert(player.canAccess(), `${context} fixture player is not busy or protected`);
    assert(target.isValid(), `${context} fixture target is valid`);
    assert(player.inOperableDistance(target), `${context} fixture has native operable adjacency`);
    World.currentTick = firstTick;
    player.setInteraction(Interaction.ENGINE, target, ServerTriggerType.APNPC2);
    assert.equal(player.getOpTrigger()?.name, '[opnpc2,_]', `${context} selects native Attack`);

    const originalRandom = JavaRandom.nextDouble;
    JavaRandom.nextDouble = () => 0.999999;
    try {
        const firstSoundStart = player.testMessages.length;
        player.processInteraction();
        assertHealthy(`${context} first swing`);
        const firstQueue = queuedAttacks();
        assert.equal(firstQueue.length, 1, `${context} queues the first native NPC hit; chat=${player.testMessages.filter(message => message?.text).map(message => message.text).join(' | ')}`);
        assert(firstQueue[0].lastInt >= 0, `${context} queues a non-negative hit`);
        if (repairedItems.has(type.id)) assert(firstQueue[0].lastInt > 0, `${context} queues positive repaired-weapon damage`);
        const firstDelay = expectedNextAttack(type, style, firstTick);
        assert.equal(player.getVar(varIds.actionDelay), firstDelay, `${context} uses the packed attack interval`);
        assertSoundSince(firstSoundStart, style, `${context} first swing`);

        const secondTick = Math.max(firstTick + 1, firstDelay);
        World.currentTick = secondTick;
        assert.equal(player.getOpTrigger()?.name, '[opnpc2,_]', `${context} retains native Attack for reattack`);
        const secondSoundStart = player.testMessages.length;
        player.processInteraction();
        assertHealthy(`${context} second swing`);
        const secondQueue = queuedAttacks();
        assert.equal(secondQueue.length, 2, `${context} repeats on an eligible tick`);
        assert(secondQueue[1].lastInt >= 0, `${context} queues a non-negative reattack hit`);
        if (repairedItems.has(type.id)) assert(secondQueue[1].lastInt > 0, `${context} queues positive repaired-weapon reattack damage`);
        assert.equal(player.getVar(varIds.actionDelay), expectedNextAttack(type, style, secondTick),
            `${context} advances the packed attack interval again`);
        assertSoundSince(secondSoundStart, style, `${context} second swing`);
        assert.equal(target.levels[NpcStat.HITPOINTS], targetHitpoints,
            `${context} observes queued hits without processing the NPC queue`);
        World.currentTick = secondTick;
    } finally {
        JavaRandom.nextDouble = originalRandom;
    }
}

const styleRows = new Map();
const silentGuardStyles = [];
for (const type of attackItems) {
    const rows = discoverStyles(type);
    styleRows.set(type.id, rows);
    if (/greegree|fungicide/i.test(itemName(type))) {
        for (const row of rows) {
            if (row.attackSound === -1) silentGuardStyles.push({ type, row });
        }
    }
}
assert(silentGuardStyles.length > 0, 'a packed greegree or fungicide right-hand item exercises the null-sound guard');

const polearmStyles = [
    { mode: 0, button: 'polearm0', nameComponent: 'com_11', name: 'Jab', stanceComponent: 'com_14',
        stance: '(Controlled)', damageComponent: 'com_17', damage: '(Stab)',
        damageType: damageType.stab, damageStyle: damageStyle.controlled },
    { mode: 1, button: 'polearm1', nameComponent: 'com_12', name: 'Swipe', stanceComponent: 'com_16',
        stance: '(Aggressive)', damageComponent: 'com_18', damage: '(Slash)',
        damageType: damageType.slash, damageStyle: damageStyle.aggressive },
    { mode: 2, button: 'polearm2', nameComponent: 'com_13', name: 'Fend', stanceComponent: 'com_15',
        stance: '(Defensive)', damageComponent: 'com_19', damage: '(Stab)',
        damageType: damageType.stab, damageStyle: damageStyle.defensive }
];
const polearmItems = [
    'bronze_halberd', 'iron_halberd', 'steel_halberd', 'black_halberd', 'white_halberd',
    'mithril_halberd', 'adamant_halberd', 'rune_halberd', 'dragon_halberd'
];
for (const item of polearmItems) {
    const type = ObjType.getByName(item);
    assert(type, `missing packed ${item}`);
    verifyStyleTab({ item, tab: 'combat_polearm', category: categoryIds.polearm, styles: polearmStyles },
        type, styleRows.get(type.id));
}

const bluntStyles = [
    { mode: 0, button: 'blunt0', nameComponent: 'com_11', name: 'Pound', stanceComponent: 'com_15',
        stance: '(Accurate)', damageComponent: 'com_17', damage: '(Crush)',
        damageType: damageType.crush, damageStyle: damageStyle.accurate },
    { mode: 1, button: 'blunt1', nameComponent: 'com_12', name: 'Pummel', stanceComponent: 'com_14',
        stance: '(Aggressive)', damageComponent: 'com_18', damage: '(Crush)',
        damageType: damageType.crush, damageStyle: damageStyle.aggressive },
    { mode: 2, button: 'blunt2', nameComponent: 'com_13', name: 'Block', stanceComponent: 'com_16',
        stance: '(Defensive)', damageComponent: 'com_19', damage: '(Crush)',
        damageType: damageType.crush, damageStyle: damageStyle.defensive }
];
for (const item of ['tzhaar_mace', 'tzhaar_maul']) {
    const type = ObjType.getByName(item);
    assert(type, `missing packed ${item}`);
    verifyStyleTab({ item, tab: 'combat_blunt', category: categoryIds.blunt, styles: bluntStyles },
        type, styleRows.get(type.id));
}

// A legitimate zero hit (including holy water against a human) is still a queued attack.
// Positive damage is required for the repaired weapon groups, not every unrelated weapon.
const repairedItems = new Set([...polearmItems, 'tzhaar_mace', 'tzhaar_maul'].map(name => id(ObjType, name)));
let attackedStyles = 0;
for (const type of attackItems) {
    for (const style of styleRows.get(type.id)) {
        assertNativeAttack(type, style);
        attackedStyles++;
    }
}
assert(attackedStyles > 0, 'native Attack covered every discovered packed style');

World.removeNpc(target, -1);
World.players[player.slot] = null;
player.unlink();
player.cleanup();
console.log(`PASS weapon-sounds: ${weapons.length} packed Wield/Wear right-hand items, ${attackItems.length - weapons.length} Hold guard items, ${attackedStyles} native styles, ${silentGuardStyles.length} null-sound guard styles`);
process.exit(0);
