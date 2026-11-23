#!/usr/bin/env node
// Source-derived expected.json is independent of the compiled object rows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_ROOT = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_ROOT, '../engine');
const PACK_DIR = process.env.HARNESS_PACK_DIR ?? path.join(ENGINE_ROOT, 'data/pack');
assert(fs.existsSync(path.join(PACK_DIR, 'server/script.dat')), 'build the sibling engine first');
const load = relative => import(pathToFileURL(path.join(ENGINE_ROOT, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const types = {};
for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType',
    'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType',
    'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType'
]) {
    types[name] = (await load(`src/cache/config/${name}.ts`)).default;
    types[name].load(PACK_DIR);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');
const { default: Player } = await load('src/engine/entity/Player.ts');
const { default: Npc } = await load('src/engine/entity/Npc.ts');
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { default: ScriptProvider } = await load('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await load('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await load('src/engine/script/ScriptState.ts');
const { default: ServerTriggerType } = await load('src/engine/script/ServerTriggerType.ts');
const { default: JavaRandom } = await load('src/util/JavaRandom.ts');
const { default: Environment } = await load('src/util/Environment.ts');
const { default: IfButton } = await load('src/network/game/client/model/IfButton.ts');
const { default: IfButtonHandler } = await load('src/network/game/client/handler/IfButtonHandler.ts');

Environment.NODE_MEMBERS = true;
Environment.NODE_PRODUCTION = false;
Environment.NODE_DEBUG_PROFILE = false;
assert(ScriptProvider.load(PACK_DIR) > 0, 'packed scripts must load');
World.currentTick = 1000;
World.gameMap.init();

const id = (type, name) => {
    const value = type.getId(name);
    assert(value >= 0, `packed identity ${name}`);
    return value;
};
const paramDefinition = name => {
    const definition = types.ParamType.getByName(name);
    assert(definition, `packed parameter ${name}`);
    return definition;
};
const intParam = (type, name) => {
    const definition = paramDefinition(name);
    return ParamHelper.getIntParam(definition.id, type, definition.defaultInt);
};
const inv = id(types.InvType, 'inv');
const worn = id(types.InvType, 'worn');
const rightHand = types.ObjType.getWearPosId('righthand');
const quiver = types.ObjType.getWearPosId('quiver');
assert(rightHand >= 0 && quiver >= 0, 'packed right-hand and quiver slots');
const varIds = {
    combatMode: id(types.VarPlayerType, 'com_mode'),
    damageType: id(types.VarPlayerType, 'damagetype'),
    damageStyle: id(types.VarPlayerType, 'damagestyle'),
    attackAnim: id(types.VarPlayerType, 'com_attackanim'),
    attackSound: id(types.VarPlayerType, 'com_attacksound'),
    defendAnim: id(types.VarPlayerType, 'com_defendanim')
};
const bonusNames = [
    'stabattack', 'slashattack', 'crushattack', 'magicattack', 'rangeattack',
    'stabdefence', 'slashdefence', 'crushdefence', 'magicdefence', 'rangedefence',
    'strengthbonus', 'prayerbonus', 'rangebonus'
];
const bonusScript = ScriptProvider.getByName('[proc,equip_get_bonuses]');
assert(bonusScript, 'packed equipment bonus calculation');
const synthIds = new Map(fs.readFileSync(path.join(CONTENT_ROOT, 'pack/synth.pack'), 'utf8')
    .trim().split(/\r?\n/).map(line => {
        const separator = line.indexOf('=');
        assert(separator > 0, `valid synth row: ${line}`);
        return [line.slice(separator + 1), Number(line.slice(0, separator))];
    }));

const expected = JSON.parse(fs.readFileSync(new URL('./expected.json', import.meta.url), 'utf8'));
assert(Array.isArray(expected) && expected.length > 0, 'source-derived weapon rows');
assert.equal(new Set(expected.map(row => row.name)).size, expected.length, 'unique source cases');

function runScript(player, name, args = []) {
    const script = ScriptProvider.getByName(name);
    assert(script, `packed script ${name}`);
    const state = ScriptRunner.init(script, player, null, args);
    assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${name} finishes`);
    return state;
}

function makePlayer(row, baseRequirements = row.requirements ?? {}, questValues = row.quests ?? {}, boosted = false) {
    const player = new Player('weaponrowtest', 0n, 0n);
    player.uid = 1;
    player.pid = 1;
    // A clean level-one account baseline; the boosted case changes current levels only.
    player.baseLevels.fill(1);
    player.levels.fill(boosted ? 99 : 1);
    for (const [skill, level] of Object.entries(baseRequirements)) {
        const stat = PlayerStat[skill.toUpperCase()];
        assert.notEqual(stat, undefined, `${row.name}: known requirement skill ${skill}`);
        player.baseLevels[stat] = level;
        if (!boosted) player.levels[stat] = level;
    }
    for (const [varpName, value] of Object.entries(questValues)) {
        const varp = types.VarPlayerType.getId(varpName);
        assert(varp >= 0, `${row.name}: packed quest varp ${varpName}`);
        player.setVar(varp, value);
    }
    player.write = () => {};
    player.messageGame = () => {};
    player.wrappedMessageGame = () => {};
    player.getInventory(inv);
    player.getInventory(worn);
    return player;
}

function attemptWear(row, baseRequirements = row.requirements ?? {}, questValues = row.quests ?? {}, boosted = false) {
    const objectId = types.ObjType.getId(row.name);
    assert(objectId >= 0, `${row.name}: packed object identity`);
    const type = types.ObjType.get(objectId);
    const player = makePlayer(row, baseRequirements, questValues, boosted);
    player.invSet(inv, objectId, 1, 0);
    player.lastItem = objectId;
    player.lastSlot = 0;

    // This is the engine's actual type -> category -> global OPHELD2 dispatch.
    const handler = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD2, objectId, type.category);
    assert(handler, `${row.name}: packed type/category/global wear dispatch`);
    assert.equal(player.runScript(ScriptRunner.init(handler, player), true, true), ScriptState.FINISHED,
        `${row.name}: native wear handler finishes`);
    return { player, type };
}

function expectRefused(row, baseRequirements, questValues, label) {
    const { player, type } = attemptWear(row, baseRequirements, questValues, true);
    assert.equal(player.invTotal(inv, type.id), 1, `${row.name} ${label}: item stays in inventory`);
    assert.equal(player.invTotal(worn, type.id), 0, `${row.name} ${label}: item is not worn`);
}

let failures = 0;
let refusals = 0;
let checkedStyles = 0;
for (const row of expected) {
    try {
        assert(row && typeof row.name === 'string', 'weapon row has a name');
        assert.deepEqual(Object.keys(row.bonuses).sort(), [...bonusNames].sort(), `${row.name}: all 13 authored bonuses`);
        for (const name of bonusNames) {
            assert(Number.isFinite(row.bonuses[name]), `${row.name}: numeric source value for ${name}`);
        }
        assert(Array.isArray(row.styles) && row.styles.length > 0, `${row.name}: authored combat styles`);

        const requirements = row.requirements ?? {};
        const quests = row.quests ?? {};
        for (const [skill, minimum] of Object.entries(requirements)) {
            expectRefused(row, { ...requirements, [skill]: minimum - 1 }, quests,
                `${skill} one below at base while current levels are boosted to 99`);
            refusals++;
        }
        for (const [varpName, minimum] of Object.entries(quests)) {
            expectRefused(row, requirements, { ...quests, [varpName]: minimum - 1 },
                `${varpName} one below`);
            refusals++;
        }

        const { player, type } = attemptWear(row, requirements, quests);
        assert.equal(type.wearpos, rightHand, `${row.name}: actual right-hand weapon slot`);
        assert.equal(player.invTotal(inv, type.id), 0, `${row.name}: native wear removes inventory item`);
        assert.equal(player.invTotal(worn, type.id), 1, `${row.name}: native wear conserves one item`);
        assert.equal(player.invGetSlot(worn, type.wearpos)?.id, type.id, `${row.name}: actual worn slot`);
        if (row.wearpos2 !== undefined && row.wearpos2 !== null) {
            const wearpos2 = typeof row.wearpos2 === 'string'
                ? types.ObjType.getWearPosId(row.wearpos2)
                : row.wearpos2;
            assert(Number.isInteger(wearpos2) && wearpos2 >= 0, `${row.name}: expected secondary wear slot`);
            assert.equal(type.wearpos2, wearpos2, `${row.name}: authored secondary wear slot`);
        }

        assert.equal(type.category, id(types.CategoryType, row.category), `${row.name}: weapon category`);
        assert(type.params.has(id(types.ParamType, 'attackrate')), `${row.name}: explicit authored attack rate`);
        assert.equal(intParam(type, 'attackrate'), row.attackrate, `${row.name}: attack rate`);
        assert.equal(intParam(type, 'attackrange'), row.attackrange, `${row.name}: attack range`);
        if (row.attackrange > 0) {
            assert(type.params.has(id(types.ParamType, 'attackrange')), `${row.name}: explicit authored attack range`);
        }
        const defendSequence = types.SeqType.getId(row.defend_anim);
        assert(defendSequence >= 0, `${row.name}: packed defend sequence ${row.defend_anim}`);
        assert.equal(intParam(type, 'defend_anim'), defendSequence, `${row.name}: defend animation`);

        const bonusState = ScriptRunner.init(bonusScript, player);
        assert.equal(player.runScript(bonusState, true, true), ScriptState.FINISHED,
            `${row.name}: compiled equipment bonus procedure finishes`);
        const actualBonuses = bonusState.intStack.slice(0, bonusState.isp);
        assert.equal(actualBonuses.length, bonusNames.length, `${row.name}: complete 13-value bonus tuple`);
        for (const [index, name] of bonusNames.entries()) {
            assert.equal(actualBonuses[index], row.bonuses[name], `${row.name}: source-derived ${name}`);
        }

        const routeModes = new Set();
        // Probe every authored mode plus one sentinel; player_combat_stat clamps the latter
        // to the final route mode, so any extra or missing mode changes this set's size.
        for (let requestedMode = 0; requestedMode <= row.styles.length; requestedMode++) {
            player.setVar(varIds.combatMode, requestedMode);
            runScript(player, '[proc,player_combat_stat]');
            const mode = player.getVar(varIds.combatMode);
            routeModes.add(mode);
            const style = row.styles[mode];
            assert(style, `${row.name}: no unexpected combat route at mode ${mode}`);
            assert.equal(player.getVar(varIds.damageType), style.type, `${row.name} mode ${mode}: damage type`);
            assert.equal(player.getVar(varIds.damageStyle), style.stance, `${row.name} mode ${mode}: stance`);
            assert.equal(typeof style.animation === 'string' && style.animation.length > 0, true,
                `${row.name} mode ${mode}: expected animation identity`);
            const animation = types.SeqType.getId(style.animation);
            assert(animation >= 0, `${row.name} mode ${mode}: packed animation ${style.animation}`);
            assert.equal(player.getVar(varIds.attackAnim), animation,
                `${row.name} mode ${mode}: compiled attack animation`);
            assert.equal(typeof style.sound === 'string' && style.sound.length > 0, true,
                `${row.name} mode ${mode}: expected sound identity`);
            assert(synthIds.has(style.sound), `${row.name} mode ${mode}: packed sound ${style.sound}`);
            const sound = synthIds.get(style.sound);
            assert(Number.isInteger(sound) && sound >= 0, `${row.name} mode ${mode}: valid packed sound id`);
            assert.equal(player.getVar(varIds.attackSound), sound,
                `${row.name} mode ${mode}: compiled attack sound`);
        }
        assert.equal(routeModes.size, row.styles.length, `${row.name}: route mode count matches authored styles`);
        assert.deepEqual([...routeModes].sort((left, right) => left - right),
            row.styles.map((_, mode) => mode), `${row.name}: authored styles are combat table mode order`);
        checkedStyles += row.styles.length;
        console.log(`PASS ${row.name}`);
    } catch (error) {
        failures++;
        console.error(`FAIL ${row?.name ?? '<unknown>'}: ${error.stack ?? error}`);
    }
}

function variable(player, name, value) {
    const varp = types.VarPlayerType.getId(name);
    assert(varp >= 0, `packed player varp ${name}`);
    if (value === undefined) return player.getVar(varp);
    player.setVar(varp, value);
}

function ammoFor(item) {
    const arrowCategory = id(types.CategoryType, 'arrows');
    const weaponRequirement = intParam(item, 'levelrequire');
    const ammo = types.ObjType.configs.find(candidate => candidate && candidate.wearpos === quiver
        && candidate.category === arrowCategory && intParam(candidate, 'levelrequire') <= weaponRequirement);
    assert(ammo, `${item.name}: packed compatible arrows`);
    return ammo;
}

let specialPlayerId = 0;
function specialFixture(item) {
    const fixture = { players: [], npcs: [] };
    const slot = ++specialPlayerId;
    const player = new Player(`weaponrows${slot}`, BigInt(slot), BigInt(slot));
    player.slot = player.pid = slot;
    player.uid = (slot << 11) | slot;
    player.isActive = true;
    player.x = player.originX = 3100;
    player.z = player.originZ = 3800;
    player.level = 0;
    player.levels.fill(99);
    player.baseLevels.fill(99);
    player.stats.fill(130344310);
    player.messages = [];
    player.write = () => {};
    player.messageGame = player.wrappedMessageGame = text => player.messages.push(String(text));
    player.logout = () => {};
    player.getInventory(worn);
    player.getInventory(inv);
    variable(player, 'tutorial', 1000);
    variable(player, 'option_nodef', 1);
    variable(player, 'action_delay', 0);
    const zone = World.gameMap.getZone(player.x, player.z, 0);
    zone.enter(player);
    World.players[slot] = player;
    World.playerLoop.add(player.hash64, player);
    fixture.players.push({ player, zone });
    runScript(player, '[proc,initalltabs]');

    player.invSet(worn, item.id, 1, item.wearpos);
    const ammo = ammoFor(item);
    player.invSet(worn, ammo.id, 20, quiver);
    variable(player, 'com_mode', 1);
    runScript(player, '[proc,update_weapon_category]', [item.id]);
    runScript(player, '[proc,player_combat_stat]');
    variable(player, 'com_maxhit', 20);
    for (const style of ['stab', 'slash', 'crush', 'range', 'magic']) {
        variable(player, `com_${style}attack`, 1000000);
    }
    variable(player, 'sa_energy', 1000);
    variable(player, 'sa_attack', 0);
    variable(player, 'action_delay', 0);

    const targetType = types.NpcType.getByName('man');
    assert(targetType, 'packed Man NPC is available for the native PvM route');
    assert.equal(targetType.op?.[1]?.toLowerCase(), 'attack', 'Man exposes native Attack');
    const target = new Npc(0, player.x + 1, player.z, targetType.size, targetType.size,
        EntityLifeCycle.RESPAWN, World.getNextNid(), targetType.id, targetType.blockwalk);
    World.addNpc(target, -1);
    World.processNpcEventQueue();
    target.lastMovement = -100;
    target.levels.fill(1);
    target.baseLevels.fill(1);
    target.levels[PlayerStat.HITPOINTS] = target.baseLevels[PlayerStat.HITPOINTS] = 255;
    fixture.npcs.push(target);
    fixture.player = player;
    fixture.target = target;
    return fixture;
}

function disposeSpecialFixture(fixture) {
    for (const target of fixture.npcs) World.removeNpc(target, 0);
    for (const { player, zone } of fixture.players) {
        zone.leave(player);
        World.players[player.slot] = null;
        player.unlink();
        player.cleanup();
    }
}

function pressSpecial(player) {
    const root = player.tabs.map(componentId => types.Component.get(componentId)).find(component => component?.comName
        && component.comName.startsWith('combat_')
        && types.Component.getByName(`${component.comName}:specbar`));
    assert(root, 'equipped weapon opened its real combat tab with a special bar');
    const button = types.Component.getByName(`${root.comName}:specbar`);
    assert(button, `${root.comName} has a packed special button`);
    assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.IF_BUTTON, button.id, -1)?.name,
        `[if_button,${root.comName}:specbar]`, 'special bar uses its compiled button handler');
    assert.equal(new IfButtonHandler().handle(new IfButton(button.id), player), true,
        'special bar is handled by native IfButtonHandler');
}

function assertNativePvMSpecial(name, expectedCost) {
    const objectId = id(types.ObjType, name);
    const item = types.ObjType.get(objectId);
    const fixture = specialFixture(item);
    const executions = [];
    const execute = ScriptRunner.execute;
    const random = JavaRandom.nextDouble;
    try {
        pressSpecial(fixture.player);
        assert.equal(variable(fixture.player, 'sa_attack'), 1, `${name}: special button enables the native toggle`);
        assert(fixture.player.canAccess(), `${name}: player can access the target`);
        assert(fixture.target.isValid(), `${name}: NPC target is valid`);
        assert(fixture.player.inOperableDistance(fixture.target), `${name}: NPC target is adjacent`);
        fixture.player.setInteraction(Interaction.ENGINE, fixture.target, ServerTriggerType.APNPC2);
        assert.equal(fixture.player.getOpTrigger()?.name, '[opnpc2,_]', `${name}: native NPC Attack dispatch`);

        // Observe (do not replace) the VM executions while the real interaction runs.
        ScriptRunner.execute = function (state) {
            const result = execute.call(this, state);
            executions.push(state.script?.name);
            return result;
        };
        JavaRandom.nextDouble = () => 0.999999;
        fixture.player.processInteraction();
        assert(executions.includes(`[label,pvm_${name}_sa]`), `${name}: compiled PvM special route ran`);
        assert.equal(variable(fixture.player, 'sa_energy'), 1000 - expectedCost,
            `${name}: real PvM special deducts ${expectedCost} from 1000`);
        assert.equal(variable(fixture.player, 'sa_attack'), 0, `${name}: PvM special consumes its toggle`);
        assert(!fixture.player.messages.some(message => /script error/i.test(message)), `${name}: no script error`);
    } finally {
        ScriptRunner.execute = execute;
        JavaRandom.nextDouble = random;
        disposeSpecialFixture(fixture);
    }
}

const shortbow = types.ObjType.get(id(types.ObjType, 'magic_shortbow'));
const longbow = types.ObjType.get(id(types.ObjType, 'magic_longbow'));
assert(shortbow.params.has(id(types.ParamType, 'attackrate')), 'magic shortbow explicit authored attack rate');
assert.equal(intParam(shortbow, 'attackrate'), 4, 'magic shortbow preserves the published default rate');
assert(shortbow.params.has(id(types.ParamType, 'attackrange')), 'magic shortbow explicit authored attack range');
assert.equal(intParam(shortbow, 'attackrange'), 7, 'magic shortbow preserves the published range');
assert.equal(intParam(shortbow, 'sa_energy'), 550, 'magic shortbow authored special cost');
assert.equal(intParam(longbow, 'sa_energy'), 350, 'magic longbow special cost remains unchanged');
assert.equal(intParam(shortbow, 'specwep'), 1, 'magic shortbow is special-enabled');
assert.equal(intParam(longbow, 'specwep'), 1, 'magic longbow is special-enabled');
assertNativePvMSpecial('magic_shortbow', 550);
assertNativePvMSpecial('magic_longbow', 350);

assert.equal(failures, 0, `${failures} weapon row(s) failed`);
console.log(`WEAPON_ROWS ${expected.length} PASS ${expected.length - failures} FAIL ${failures} REFUSALS ${refusals} STYLES ${checkedStyles}`);
console.log('RESULT PASS');
// World owns background workers; no server was started.
process.exit(0);
