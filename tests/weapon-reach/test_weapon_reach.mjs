#!/usr/bin/env node
/**
 * Exercise compiled NPC and PvP Attack dispatch at packed melee reach.
 * The fixture walks real map collision and witnesses the native hit queues.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(here, '../../../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const GameMap = await load('src/engine/GameMap.ts');
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const { CollisionFlag, CollisionType } = await load('src/engine/routefinder/index.ts');
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
assert(ScriptProvider.load(pack) > 0, 'load the real compiled content pack');
const { VarPlayerType, VarNpcType, NpcType, ObjType, InvType, ParamType } = configs;
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
assert(rightHand >= 0, 'packed right-hand equipment slot exists');
const combatMode = id(VarPlayerType, 'com_mode');
const npcAggressivePlayer = id(VarNpcType, 'npc_aggressive_player');
const attackRangeParam = param('attackrange');
const runeHalberd = ObjType.getByName('rune_halberd');
const bronzeDagger = ObjType.getByName('bronze_dagger');
assert(runeHalberd, 'packed Rune halberd exists');
assert(bronzeDagger, 'packed Bronze dagger exists');
const packedHalberdRange = intParam(runeHalberd, attackRangeParam);
const packedDaggerRange = intParam(bronzeDagger, attackRangeParam);
assert.equal(packedHalberdRange, 2, 'Rune halberd keeps its packed two-tile attackrange');
assert.equal(packedDaggerRange, 0, 'Bronze dagger keeps the packed no-extended-range default');
// Ordinary melee still reaches one adjacent tile through the native OP trigger.
const daggerReach = Math.max(1, packedDaggerRange);
assert.equal(daggerReach, 1, 'Bronze dagger has only adjacent native melee reach');
const reachCases = [
    { label: 'Rune halberd at packed reach', weapon: runeHalberd, reach: packedHalberdRange, startDistance: packedHalberdRange },
    { label: 'Rune halberd one tile beyond packed reach', weapon: runeHalberd, reach: packedHalberdRange, startDistance: packedHalberdRange + 1 },
    { label: 'Bronze dagger from two tiles', weapon: bronzeDagger, reach: daggerReach, startDistance: daggerReach + 1 }
];
const corridorLength = Math.max(...reachCases.map(test => test.startDistance));

const manType = NpcType.getByName('man');
assert(manType, 'packed Man NPC is available as a native Attack target');
assert.equal(manType.op?.[1]?.toLowerCase(), 'attack', 'Man exposes the native Attack option');

World.currentTick = 100;
World.gameMap.init();
function clearStraightCorridor(x, z, dx, dz, steps) {
    const endX = x + dx * steps;
    const endZ = z + dz * steps;
    for (let step = 0; step <= steps; step++) {
        const tileX = x + dx * step;
        const tileZ = z + dz * step;
        if (!World.gameMap.hasZone(tileX, tileZ, 0) || GameMap.isMapBlocked(tileX, tileZ, 0)) {
            return false;
        }
        if (step < steps && !GameMap.canTravel(
            0, tileX, tileZ, dx, dz, 1, CollisionFlag.BLOCK_NPC_AND_PLAYERS, CollisionType.NORMAL
        )) {
            return false;
        }
    }
    return GameMap.isLineOfWalk(0, x, z, endX, endZ);
}

// Reuse the known wilderness fixture area and select an actually clear, packed-map corridor there.
const corridorOrigin = { x: 3200, z: 3600 };
let corridor = null;
for (let radius = 0; radius <= 16 && !corridor; radius++) {
    for (let x = corridorOrigin.x - radius; x <= corridorOrigin.x + radius && !corridor; x++) {
        for (let z = corridorOrigin.z - radius; z <= corridorOrigin.z + radius && !corridor; z++) {
            if (Math.max(Math.abs(x - corridorOrigin.x), Math.abs(z - corridorOrigin.z)) !== radius) continue;
            for (const [dx, dz] of [[1, 0], [0, 1]]) {
                if (clearStraightCorridor(x, z, dx, dz, corridorLength)) {
                    corridor = { level: 0, x, z, dx, dz };
                    break;
                }
            }
        }
    }
}
assert(corridor, 'find a clear straight corridor in the loaded wilderness collision map');

let nextSlot = 1;
function createPlayer(label, position) {
    const slot = nextSlot++;
    const identity = 1000 + slot;
    const player = new Player(`weapon-reach-${label}-${slot}`, BigInt(identity), BigInt(identity));
    player.slot = slot;
    player.pid = slot;
    player.uid = (identity << 11) | slot;
    player.level = position.level;
    player.x = position.x;
    player.z = position.z;
    player.isActive = true;
    for (const stat of [PlayerStat.ATTACK, PlayerStat.DEFENCE, PlayerStat.STRENGTH,
        PlayerStat.HITPOINTS, PlayerStat.RANGED, PlayerStat.MAGIC]) {
        player.baseLevels[stat] = 99;
        player.levels[stat] = 99;
    }
    player.stats.fill(0);
    player.getInventory(worn);
    player.getInventory(inventory);
    player.testMessages = [];
    player.logoutCalls = 0;
    player.write = packet => player.testMessages.push(packet);
    player.messageGame = text => player.testMessages.push({ text: String(text) });
    player.wrappedMessageGame = player.messageGame;
    player.logout = () => { player.logoutCalls++; };
    // Fresh fixture players have not passed through a world movement tick yet.
    player.moveSpeed = player.defaultMoveSpeed();
    World.players[player.slot] = player;
    World.playerLoop.add(player.hash64, player);
    return player;
}

function cleanupPlayer(player) {
    if (!player) return;
    player.clearInteraction();
    World.players[player.slot] = null;
    player.unlink();
    player.cleanup();
}

function assertHealthy(player, context) {
    const errors = player.testMessages.filter(message =>
        typeof message?.text === 'string' && /script error/i.test(message.text));
    assert.equal(errors.length, 0, `${context} has no script error`);
    assert.equal(player.logoutCalls, 0, `${context} does not log out`);
}

function runPlayerScript(player, name) {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing packed script ${name}`);
    const state = ScriptRunner.init(script, player, null);
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    player.executeScript(state, true, true);
    assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes`);
    assertHealthy(player, name);
    return state;
}

function prepareAttacker(player, weapon) {
    player.getInventory(worn).set(rightHand, { id: weapon.id, count: 1 });
    player.setVar(combatMode, 0);
    runPlayerScript(player, '[proc,player_combat_stat]');
}

function startPosition(distance) {
    return {
        level: corridor.level,
        x: corridor.x + corridor.dx * (corridorLength - distance),
        z: corridor.z + corridor.dz * (corridorLength - distance)
    };
}

function lineOfWalkToTarget(start, target) {
    return GameMap.isLineOfWalk(start.level, start.x, start.z, target.x, target.z);
}

function assertMovementAndQueue(player, start, target, test, mode, queue) {
    const expectedSteps = Math.max(0, test.startDistance - test.reach);
    assert.equal(player.x, start.x + corridor.dx * expectedSteps,
        `${mode} ${test.label} takes only the required straight approach step(s)`);
    assert.equal(player.z, start.z + corridor.dz * expectedSteps,
        `${mode} ${test.label} stays on the clear straight approach`);
    const finalDistance = Math.max(Math.abs(player.x - target.x), Math.abs(player.z - target.z));
    assert.equal(finalDistance, test.reach, `${mode} ${test.label} attacks at its effective packed reach`);
    assert.equal(queue.length, 1, `${mode} ${test.label} queues its native hit`);
    const damage = mode === 'NPC' ? queue[0].lastInt : queue[0].args[0];
    assert(Number.isInteger(damage) && damage >= 0, `${mode} ${test.label} queues non-negative damage`);
}

function exerciseNpc(test) {
    const start = startPosition(test.startDistance);
    const targetPosition = {
        level: corridor.level,
        x: corridor.x + corridor.dx * corridorLength,
        z: corridor.z + corridor.dz * corridorLength
    };
    let player;
    let target;
    try {
        player = createPlayer('npc', start);
        prepareAttacker(player, test.weapon);
        target = new Npc(targetPosition.level, targetPosition.x, targetPosition.z, manType.size, manType.size,
            EntityLifeCycle.DESPAWN, World.getNextNid(), manType.id, manType.blockwalk);
        World.addNpc(target, -1);
        target.lastMovement = -100;
        target.setVar(npcAggressivePlayer, player.uid);

        assert(player.canAccess(), `NPC ${test.label} attacker is available`);
        assert(target.isValid(), `NPC ${test.label} target is valid`);
        assert.equal(player.inOperableDistance(target), false, `NPC ${test.label} starts outside adjacent OP distance`);
        assert(lineOfWalkToTarget(start, targetPosition), `NPC ${test.label} has clear packed line of walk`);
        assert.equal(player.setInteraction(Interaction.ENGINE, target, ServerTriggerType.APNPC2), true,
            `NPC ${test.label} accepts the native Attack interaction`);
        assert.equal(player.getOpTrigger()?.name, '[opnpc2,_]', `NPC ${test.label} resolves native OP dispatch`);
        assert.equal(player.getApTrigger()?.name, '[apnpc2,_]', `NPC ${test.label} resolves native AP dispatch`);

        const originalRandom = JavaRandom.nextDouble;
        JavaRandom.nextDouble = () => 0.999999;
        try {
            player.processInteraction();
        } finally {
            JavaRandom.nextDouble = originalRandom;
        }
        assertHealthy(player, `NPC ${test.label}`);
        const hits = [...target.queue.all()].filter(request => request.queueId === ServerTriggerType.AI_QUEUE2);
        assertMovementAndQueue(player, start, targetPosition, test, 'NPC', hits);
    } finally {
        if (player) player.clearInteraction();
        if (target) World.removeNpc(target, -1);
        cleanupPlayer(player);
    }
}

function exercisePvp(test) {
    const start = startPosition(test.startDistance);
    const targetPosition = {
        level: corridor.level,
        x: corridor.x + corridor.dx * corridorLength,
        z: corridor.z + corridor.dz * corridorLength
    };
    let player;
    let opponent;
    try {
        player = createPlayer('pvp-attacker', start);
        opponent = createPlayer('pvp-target', targetPosition);
        prepareAttacker(player, test.weapon);

        assert(player.canAccess() && opponent.canAccess(), `PvP ${test.label} players are available`);
        assert(opponent.isValid(), `PvP ${test.label} target is valid`);
        assert.equal(player.inOperableDistance(opponent), false, `PvP ${test.label} starts outside adjacent OP distance`);
        assert(lineOfWalkToTarget(start, targetPosition), `PvP ${test.label} has clear packed line of walk`);
        assert.equal(player.setInteraction(Interaction.ENGINE, opponent, ServerTriggerType.APPLAYER2), true,
            `PvP ${test.label} accepts the native Attack interaction`);
        assert.equal(player.getOpTrigger()?.name, '[opplayer2,_]', `PvP ${test.label} resolves native OP dispatch`);
        assert.equal(player.getApTrigger()?.name, '[applayer2,_]', `PvP ${test.label} resolves native AP dispatch`);

        const originalRandom = JavaRandom.nextDouble;
        JavaRandom.nextDouble = () => 0.999999;
        try {
            player.processInteraction();
        } finally {
            JavaRandom.nextDouble = originalRandom;
        }
        assertHealthy(player, `PvP ${test.label} attacker`);
        assertHealthy(opponent, `PvP ${test.label} target`);
        const hits = [...opponent.queue.all()].filter(request => request.script.name === '[queue,pvp_damage]');
        assertMovementAndQueue(player, start, targetPosition, test, 'PvP', hits);
    } finally {
        if (player) player.clearInteraction();
        cleanupPlayer(opponent);
        cleanupPlayer(player);
    }
}

for (const test of reachCases) {
    exerciseNpc(test);
    exercisePvp(test);
}

console.log('PASS weapon-reach: compiled NPC and PvP Attack dispatch uses packed reach and collision-aware approach');
process.exit(0);
