#!/usr/bin/env node
/**
 * Exercise compiled NPC and PvP Attack dispatch at packed melee reach.
 * The fixture walks real map collision and witnesses the native hit queues.
 * Greegree retaliation preserves the native next-phase knock-off timing,
 * the first refusal, normal human retaliation, and the owner-scoped full-inventory drop.
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
const { NpcMode } = await load('src/engine/entity/NpcMode.ts');
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const { CollisionFlag, CollisionType, isFlagged } = await load('src/engine/routefinder/index.ts');
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

function exerciseGreegree() {
    let apeCorridor;
    for (let x = 2700; x < 2750 && !apeCorridor; x++) {
        for (let z = 2700; z < 2750; z++) {
            if (clearStraightCorridor(x, z, 1, 0, 3)) {
                apeCorridor = { level: 0, x, z };
                break;
            }
        }
    }
    assert(apeCorridor, 'find a clear packed corridor inside the greegree zone');
    const greegree = ObjType.getByName('mm_monkey_greegree_for_normal_monkey');
    assert(greegree, 'packed normally obtainable monkey greegree');
    for (const test of [
        { label: 'far worn', distance: 3, hold: true },
        { label: 'adjacent worn', distance: 1, hold: true },
        { label: 'carried only', distance: 2, hold: false }
    ]) {
        const start = { ...apeCorridor, x: apeCorridor.x + 3 - test.distance };
        const player = createPlayer('greegree', start);
        let target;
        try {
            prepareAttacker(player, bronzeDagger);
            player.invAdd(inventory, greegree.id, 1);
            if (test.hold) {
                player.lastSlot = player.getInventory(inventory).getItemIndex(greegree.id);
                player.lastItem = greegree.id;
                const hold = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD2, greegree.id, greegree.category);
                assert.equal(hold?.name, '[opheld2,_mm_greegree]', 'native inventory lookup selects Hold');
                const state = ScriptRunner.init(hold, player, null);
                player.executeScript(state, true, true);
                assert.equal(state.execution, ScriptState.FINISHED, 'ordinary Hold finishes');
                assert.equal(player.getInventory(worn).get(rightHand)?.id, greegree.id, 'ordinary Hold equips the greegree');
                assert.equal(player.npcId, id(NpcType, 'mm_transmogrification_normal_monkey'), 'ordinary Hold creates monkey form');
            }
            target = new Npc(0, apeCorridor.x + 3, apeCorridor.z, manType.size, manType.size,
                EntityLifeCycle.DESPAWN, World.getNextNid(), manType.id, manType.blockwalk);
            World.addNpc(target, -1);
            target.lastMovement = -100;
            target.setVar(npcAggressivePlayer, player.uid);
            player.testMessages.length = 0;
            assert(player.setInteraction(Interaction.ENGINE, target, ServerTriggerType.APNPC2), `${test.label}: native Attack`);
            assert.equal(player.getOpTrigger()?.name, '[opnpc2,_]');
            assert.equal(player.getApTrigger()?.name, '[apnpc2,_]');
            player.processInteraction();
            assertHealthy(player, test.label);
            const hits = [...target.queue.all()].filter(request => request.queueId === ServerTriggerType.AI_QUEUE2);
            const text = player.testMessages.map(packet => packet.text ?? '').join(' ');
            if (test.hold) {
                assert(text.includes('You cannot attack as a monkey.'), `${test.label}: exact inherited refusal`);
                assert.deepEqual([player.x, player.z], [start.x, start.z], `${test.label}: refusal precedes movement`);
                assert.equal(hits.length, 0, `${test.label}: no hit queued`);
            } else {
                assert(!text.includes('You cannot attack as a monkey.'), 'carrying alone is not refused');
                assert.equal(hits.length, 1, 'carrying alone reaches native melee delivery');
                assert.equal(player.x, target.x - 1, 'carrying alone approaches to adjacent range');
            }
            console.log(`PASS greegree Attack ${test.label}: start=${start.x},${start.z} end=${player.x},${player.z} hits=${hits.length}`);
        } finally {
            if (target) World.removeNpc(target, -1);
            cleanupPlayer(player);
        }
    }
    for (const { label, hold, full } of [
        { label: 'ordinary human hit', hold: false, full: false },
        { label: 'monkey hit', hold: true, full: false },
        { label: 'full-inventory monkey hit', hold: true, full: true }
    ]) {
        const player = createPlayer('greegree-retaliation', apeCorridor);
        let attacker;
        let dropped;
        try {
            prepareAttacker(player, bronzeDagger);
            if (hold) {
                player.invAdd(inventory, greegree.id, 1);
                player.lastSlot = player.getInventory(inventory).getItemIndex(greegree.id);
                player.lastItem = greegree.id;
                const script = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD2, greegree.id, greegree.category);
                assert.equal(script?.name, '[opheld2,_mm_greegree]', `${label}: native Hold handler`);
                const state = ScriptRunner.init(script, player, null);
                player.executeScript(state, true, true);
                assert.equal(state.execution, ScriptState.FINISHED, `${label}: ordinary Hold finishes`);
                assert.equal(player.npcId, id(NpcType, 'mm_transmogrification_normal_monkey'),
                    `${label}: ordinary Hold creates the form`);
            }
            if (full) {
                assert.equal(player.invTotal(inventory, bronzeDagger.id), 1,
                    `${label}: Hold returned the ordinary weapon to inventory`);
                player.invAdd(inventory, bronzeDagger.id, InvType.get(inventory).size - 1);
                assert.equal(player.invTotal(inventory, bronzeDagger.id), InvType.get(inventory).size,
                    `${label}: unstackable daggers fill every inventory slot`);
            }
            attacker = new Npc(0, apeCorridor.x + 1, apeCorridor.z, manType.size, manType.size,
                EntityLifeCycle.DESPAWN, World.getNextNid(), manType.id, manType.blockwalk);
            World.addNpc(attacker, -1);
            attacker.setInteraction(Interaction.SCRIPT, player, NpcMode.OPPLAYER2);
            assert.strictEqual(attacker.target, player, `${label}: native NPC attack targets the player`);
            const incomingHit = () => {
                const beforeHealth = player.levels[PlayerStat.HITPOINTS];
                const originalRandom = JavaRandom.nextDouble;
                let draw = 0;
                const tape = [0.999999, 0, 0.999999];
                JavaRandom.nextDouble = () => tape[Math.min(draw++, tape.length - 1)];
                try {
                    attacker.turn();
                    World.processNpcEventQueue();
                    assert([...player.queue.all()].some(request => request.script.name === '[queue,playerhit_n_retaliate]'),
                        `${label}: native NPC hit schedules retaliation at tick ${World.currentTick}`);
                    player.processQueues();
                } finally {
                    JavaRandom.nextDouble = originalRandom;
                }
                assertHealthy(player, label);
                assert(player.levels[PlayerStat.HITPOINTS] < beforeHealth,
                    `${label}: real incoming damage lands at tick ${World.currentTick}`);
            };
            const refusalCount = () => player.testMessages.filter(packet =>
                packet.text === 'You cannot attack as a monkey.').length;
            player.testMessages.length = 0;
            const hitTick = ++World.currentTick;
            incomingHit();
            assert.equal(World.currentTick, hitTick, `${label}: one player queue phase in hit tick ${hitTick}`);
            assert.equal(player.npcId, hold ? id(NpcType, 'mm_transmogrification_normal_monkey') : -1,
                `${label}: form is unchanged in hit tick ${hitTick}`);
            const pending = [...player.queue.all()].filter(request =>
                request.script.name === '[queue,force_unequip_greegree]');
            assert.equal(pending.length, hold ? 1 : 0,
                `${label}: exact knock-off queue count in hit tick ${hitTick}`);
            player.processInteraction();
            console.log(`OBSERVE ${label}: hitTick=${hitTick} firstHitRefusalBoxes=${refusalCount()}`);
            assert.equal(refusalCount(), hold ? 1 : 0,
                `${label}: first hit's retaliation refusal count at tick ${hitTick}`);
            if (hold) {
                assert.equal(player.getInventory(worn).get(rightHand)?.id, greegree.id,
                    `${label}: still worn at tick ${hitTick}`);
                assert.equal(player.invTotal(inventory, greegree.id), 0,
                    `${label}: not yet returned at tick ${hitTick}`);
                World.currentTick++;
                player.processQueues();
                assert.equal(World.currentTick, hitTick + 1,
                    `${label}: following queue phase is exactly tick ${hitTick + 1}`);
                assert.equal(player.npcId, -1, `${label}: human form at tick ${hitTick + 1}`);
                assert.equal(player.getInventory(worn).get(rightHand), null,
                    `${label}: greegree leaves the worn slot at tick ${hitTick + 1}`);
                assert.equal(player.invTotal(inventory, greegree.id), full ? 0 : 1,
                    `${label}: inventory result at tick ${hitTick + 1}`);
                assert(![...player.queue.all()].some(request =>
                    request.script.name === '[queue,force_unequip_greegree]'),
                    `${label}: knock-off queue consumed at tick ${hitTick + 1}`);
                assert.equal(player.testMessages.filter(packet =>
                    packet.text?.startsWith('The Monkey Greegree wrenches itself')).length,
                    1, `${label}: one inherited knock-off message`);
                assert(player.testMessages.map(packet => packet.text ?? '').join(' ').includes(
                    'The Monkey Greegree wrenches itself from your hand as its power begins to fade...'),
                    `${label}: inherited knock-off text spans its rendered lines`);
                if (full) {
                    const zone = World.gameMap.getZone(player.x, player.z, player.level);
                    dropped = zone.getObj(player.x, player.z, greegree.id, player.hash64);
                    assert(dropped?.isValid(), `${label}: owner can see the dropped greegree`);
                    assert.equal(dropped.count, 1, `${label}: one greegree on the floor`);
                    assert.equal(dropped.receiver64, player.hash64, `${label}: drop belongs to the player`);
                    assert.equal(zone.getObj(player.x, player.z, greegree.id, -1n), null,
                        `${label}: not initially visible to another receiver`);
                    assert.equal(dropped.lifecycleTick, 300,
                        `${label}: ordinary floor lifetime is 300 ticks`);
                }
                player.processInteraction();
                assert.equal(refusalCount(), 1, `${label}: following phase adds no refusal`);
                assert.equal([...attacker.queue.all()].filter(request =>
                    request.queueId === ServerTriggerType.AI_QUEUE2).length, 0,
                    `${label}: the refused first retaliation queues no hit`);
                player.testMessages.length = 0;
                World.currentTick = Math.max(World.currentTick + 1,
                    attacker.getVar(id(VarNpcType, 'npc_action_delay')));
                const nextHitTick = World.currentTick;
                incomingHit();
                player.processInteraction();
                World.currentTick = Math.max(World.currentTick, player.getVar(id(VarPlayerType, 'action_delay')));
                player.processInteraction();
                assert.equal(refusalCount(), 0, `${label}: next incoming hit retaliates without a refusal box`);
                console.log(`PASS greegree knock-off ${label}: hitTick=${hitTick} unequipTick=${hitTick + 1} ` +
                    `nextHitTick=${nextHitTick} counterHitTick=${World.currentTick} firstHitRefusalBoxes=1 nextHitRefusalBoxes=0 ` +
                    `greegreeDestination=${full ? 'owner floor, 300 ticks' : 'inventory'}`);
            } else {
                assert.equal(player.getInventory(worn).get(rightHand)?.id, bronzeDagger.id,
                    `${label}: ordinary equipment unchanged`);
                World.currentTick = Math.max(World.currentTick, player.getVar(id(VarPlayerType, 'action_delay')));
                player.processInteraction();
            }
            assertHealthy(player, `${label} retaliation`);
            assert.equal([...attacker.queue.all()].filter(request => request.queueId === ServerTriggerType.AI_QUEUE2).length,
                1, `${label}: native human retaliation queues a hit`);
            console.log(`PASS greegree retaliation ${label}`);
        } finally {
            if (dropped) World.removeObj(dropped, -1);
            if (attacker) World.removeNpc(attacker, -1);
            cleanupPlayer(player);
        }
    }
}

const wallFlagEntries = Object.entries(CollisionFlag).filter(([name]) => name.startsWith('WALL_'));
const diagonalWallFlags = new Set([
    'WALL_NORTH_WEST', 'WALL_NORTH_EAST', 'WALL_SOUTH_EAST', 'WALL_SOUTH_WEST'
]);

function packedFloorTile(x, z) {
    return World.gameMap.hasZone(x, z, 0) && !GameMap.isMapBlocked(x, z, 0);
}

function wallFlagsAt(x, z) {
    return wallFlagEntries.filter(([, flag]) => isFlagged(x, z, 0, flag)).map(([name]) => name);
}

function wallFlagsFor(tiles) {
    return tiles.flatMap(tile => {
        const flags = wallFlagsAt(tile.x, tile.z);
        return flags.length === 0 ? [] : [{ label: tile.label, x: tile.x, z: tile.z, flags }];
    });
}

function findHalberdTargetEdge(startToExclude) {
    const approaches = [
        { dx: 2, dz: 0, targetEdge: 'WALL_WEST' },
        { dx: -2, dz: 0, targetEdge: 'WALL_EAST' },
        { dx: 0, dz: 2, targetEdge: 'WALL_SOUTH' },
        { dx: 0, dz: -2, targetEdge: 'WALL_NORTH' }
    ];
    for (let x = 3190; x <= 3230; x++) {
        for (let z = 3190; z <= 3230; z++) {
            if (x === startToExclude.x && z === startToExclude.z) continue;
            for (const { dx, dz, targetEdge } of approaches) {
                const start = { level: 0, x, z };
                const target = { level: 0, x: x + dx, z: z + dz };
                const lineTiles = [0, 1, 2].map(step => ({
                    x: x + Math.sign(dx) * step,
                    z: z + Math.sign(dz) * step
                }));
                if (!lineTiles.every(tile => packedFloorTile(tile.x, tile.z))) continue;
                const targetFlags = wallFlagsAt(target.x, target.z);
                if (!targetFlags.includes(targetEdge) ||
                    !targetFlags.includes(`${targetEdge}_PROJ_BLOCKER`)) continue;
                if (GameMap.isLineOfWalk(0, start.x, start.z, target.x, target.z) ||
                    GameMap.isLineOfSight(0, start.x, start.z, target.x, target.z)) continue;
                return {
                    start,
                    target,
                    requiredWallFlag: targetEdge,
                    wallTiles: lineTiles.map((tile, index) => ({
                        label: index === 0 ? 'attacker' : index === 2 ? 'target' : 'between',
                        ...tile
                    }))
                };
            }
        }
    }
    return null;
}

function findHalberdDiagonalCorner(startToExclude) {
    const diagonals = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
    for (let x = 3190; x <= 3230; x++) {
        for (let z = 3190; z <= 3230; z++) {
            if (x === startToExclude.x && z === startToExclude.z) continue;
            for (const [dx, dz] of diagonals) {
                const start = { level: 0, x, z };
                const target = { level: 0, x: x + dx, z: z + dz };
                const corner = { x: x + dx / 2, z: z + dz / 2 };
                const minX = Math.min(start.x, target.x);
                const maxX = Math.max(start.x, target.x);
                const minZ = Math.min(start.z, target.z);
                const maxZ = Math.max(start.z, target.z);
                const gridTiles = [];
                let walkable = true;
                for (let tileX = minX; tileX <= maxX; tileX++) {
                    for (let tileZ = minZ; tileZ <= maxZ; tileZ++) {
                        if (!packedFloorTile(tileX, tileZ)) walkable = false;
                        gridTiles.push({
                            label: tileX === start.x && tileZ === start.z ? 'attacker' :
                                tileX === target.x && tileZ === target.z ? 'target' :
                                    tileX === corner.x && tileZ === corner.z ? 'corner' : 'between',
                            x: tileX,
                            z: tileZ
                        });
                    }
                }
                if (!walkable) continue;
                const cornerFlag = wallFlagsAt(corner.x, corner.z)
                    .find(flag => diagonalWallFlags.has(flag));
                if (!cornerFlag) continue;
                if (GameMap.isLineOfWalk(0, start.x, start.z, target.x, target.z) ||
                    GameMap.isLineOfSight(0, start.x, start.z, target.x, target.z)) continue;
                return { start, target, requiredWallFlag: cornerFlag, wallTiles: gridTiles };
            }
        }
    }
    return null;
}

function observeHalberdWallCase(test) {
    let player;
    let target;
    try {
        player = createPlayer(`wall-${test.label}`, test.start);
        prepareAttacker(player, runeHalberd);
        target = new Npc(0, test.target.x, test.target.z, manType.size, manType.size,
            EntityLifeCycle.DESPAWN, World.getNextNid(), manType.id, manType.blockwalk);
        World.addNpc(target, -1);
        target.lastMovement = -100;
        target.setVar(npcAggressivePlayer, player.uid);

        const initialLineOfWalk = lineOfWalkToTarget(test.start, test.target);
        const initialLineOfSight = GameMap.isLineOfSight(
            test.start.level, test.start.x, test.start.z, test.target.x, test.target.z
        );
        const wallFlags = wallFlagsFor(test.wallTiles);
        const interactionSelected =
            player.setInteraction(Interaction.ENGINE, target, ServerTriggerType.APNPC2);
        const nativeAttackSelected = interactionSelected &&
            player.getOpTrigger()?.name === '[opnpc2,_]' &&
            player.getApTrigger()?.name === '[apnpc2,_]';
        assert(nativeAttackSelected, `halberd wall ${test.label} selects native Attack dispatch`);
        player.processInteraction();
        assertHealthy(player, `halberd wall ${test.label}`);

        const hits = [...target.queue.all()].filter(request => request.queueId === ServerTriggerType.AI_QUEUE2);
        const queuedDamage = hits.map(hit => hit.lastInt);
        const finalLineOfWalk = lineOfWalkToTarget(player, test.target);
        const finalLineOfSight = GameMap.isLineOfSight(
            player.level, player.x, player.z, test.target.x, test.target.z
        );
        const finalDistance = Math.max(Math.abs(player.x - test.target.x), Math.abs(player.z - test.target.z));
        const attackThroughWall = !finalLineOfWalk && queuedDamage.length > 0;
        const assertions = {
            packedWallFlagPresent: wallFlags.some(tile => tile.flags.includes(test.requiredWallFlag)),
            initialLineOfWalkBlocked: !initialLineOfWalk,
            initialLineOfSightBlocked: !initialLineOfSight,
            nativeAttackSelected,
            finalLineOfWalkBlocked: !finalLineOfWalk,
            finalLineOfSightBlocked: !finalLineOfSight,
            expectedApproach: test.approaches ? finalDistance === 1 :
                player.x === test.start.x && player.z === test.start.z,
            noQueuedHit: queuedDamage.length === 0
        };
        for (const [name, passed] of Object.entries(assertions)) {
            assert.equal(passed, true, `halberd wall ${test.label}: ${name}`);
        }
        console.log(`HALBERD_WALL ${JSON.stringify({
            case: test.label,
            start: test.start,
            target: test.target,
            end: { level: player.level, x: player.x, z: player.z },
            wallFlags,
            initialLineOfWalk,
            finalLineOfWalk,
            initialLineOfSight,
            finalLineOfSight,
            queuedDamage,
            attackThroughWall,
            assertions
        })}`);

    } finally {
        if (target) World.removeNpc(target, -1);
        cleanupPlayer(player);
    }
}

function observeHalberdWall() {
    let attackerEdge;
    for (let x = 3190; x <= 3230 && !attackerEdge; x++) {
        for (let z = 3190; z <= 3230; z++) {
            if (isFlagged(x, z, 0, CollisionFlag.WALL_EAST) &&
                [0, 1, 2].every(offset => packedFloorTile(x + offset, z))) {
                attackerEdge = { level: 0, x, z };
                break;
            }
        }
    }
    assert(attackerEdge, 'find a real packed attacker-edge wall and three walkable floor tiles');
    const attackerEdgeTarget = { ...attackerEdge, x: attackerEdge.x + 2 };
    assert.equal(lineOfWalkToTarget(attackerEdge, attackerEdgeTarget), false,
        'packed attacker-edge wall blocks the initial two-tile line');

    const targetEdge = findHalberdTargetEdge(attackerEdge);
    assert(targetEdge, 'find a real packed wall on the target edge with walk and projectile collision');
    const diagonalCorner = findHalberdDiagonalCorner(attackerEdge);
    assert(diagonalCorner, 'find a real packed diagonal wall corner between two-tile-reach endpoints');

    observeHalberdWallCase({
        label: 'attacker-edge',
        start: attackerEdge,
        target: attackerEdgeTarget,
        requiredWallFlag: 'WALL_EAST',
        wallTiles: [{ label: 'attacker', x: attackerEdge.x, z: attackerEdge.z }],
        approaches: false
    });
    observeHalberdWallCase({
        ...targetEdge,
        label: 'target-edge',
        approaches: true
    });
    observeHalberdWallCase({
        ...diagonalCorner,
        label: 'diagonal-corner',
        approaches: true
    });
}

for (const test of reachCases) {
    exerciseNpc(test);
    exercisePvp(test);
}
exerciseGreegree();
observeHalberdWall();

console.log('PASS weapon-reach: compiled NPC and PvP Attack dispatch uses packed reach and collision-aware approach');
process.exit(0);
