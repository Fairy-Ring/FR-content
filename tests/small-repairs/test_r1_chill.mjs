#!/usr/bin/env node
// From the sibling engine: node --import tsx ../content/tests/small-repairs/test_r1_chill.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine');
const packDir = path.join(engineRoot, 'data/pack');
const load = async relativePath => (await import(pathToFileURL(path.join(engineRoot, 'src', relativePath)).href)).default;

let World;
let player;
let originalTick;
let playerSlot = -1;
let previousSlotPlayer;
let exitCode = 0;

try {
    World = await load('engine/World.ts');
    const Player = await load('engine/entity/Player.ts');
    const ScriptProvider = await load('engine/script/ScriptProvider.ts');
    const ScriptRunner = await load('engine/script/ScriptRunner.ts');
    const ScriptState = await load('engine/script/ScriptState.ts');

    for (const name of [
        'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType',
        'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType',
        'ParamType', 'CategoryType', 'StructType', 'MesanimType'
    ]) {
        const type = await load(`cache/config/${name}.ts`);
        type.load(packDir);
    }

    assert.ok(ScriptProvider.load(packDir) > 0, 'full compiled pack required');
    World.gameMap.init();
    const zoneEntryName = '[zone,0_44_58_0_24]';
    const zoneExitName = '[zoneexit,0_44_58_0_24]';
    const mapZoneExitName = '[mapzoneexit,0_44_58]';
    const timerScript = ScriptProvider.getByName('[timer,chill]');
    const refreshScript = ScriptProvider.getByName('[proc,refresh_chill]');
    assert.ok(ScriptProvider.getByName(zoneEntryName), `packed ${zoneEntryName} missing`);
    assert.ok(ScriptProvider.getByName(zoneExitName), `packed ${zoneExitName} missing`);
    assert.ok(ScriptProvider.getByName(mapZoneExitName), `packed ${mapZoneExitName} missing`);
    assert.ok(timerScript, 'packed [timer,chill] missing');
    assert.ok(refreshScript, 'packed [proc,refresh_chill] missing');

    originalTick = World.currentTick;
    World.currentTick = 5000;

    const username37 = 12345n;
    player = new Player('chill_timer_regression', username37, 1n);
    playerSlot = World.getNextPlayerSlot();
    assert.ok(playerSlot > 0, 'a free test player slot is required');
    previousSlotPlayer = World.players[playerSlot];
    player.slot = playerSlot;
    player.pid = playerSlot;
    player.uid = (Number(username37 & 0x1fffffn) << 11) | playerSlot;
    player.staffModLevel = 3;
    player.packets = [];
    player.write = packet => player.packets.push(packet);
    player.messageGame = text => player.packets.push({ text });
    player.wrappedMessageGame = player.messageGame;
    World.players[playerSlot] = player;

    const statCount = player.levels.length;
    const hitpoints = 3; // PlayerStat.HITPOINTS
    assert.equal(statCount, 21, 'expected all 21 player stats');
    const levels = () => Array.from(player.levels);
    const setAllLevels = value => {
        player.levels.fill(value);
        player.baseLevels.fill(value);
    };
    const queueEntries = () => Array.from(player.queue.all());
    const engineQueueNames = () => Array.from(player.engineQueue.all(), request => request.script.name);
    const expectedLevels = value => new Array(statCount).fill(value);
    const normalTimer = 0; // PlayerTimerType.NORMAL
    const drainInterval = 10;

    setAllLevels(60);
    player.runenergy = 8400;
    const coldX = 44 * 64 + 7;
    const coldZ = 58 * 64 + 31;
    player.teleport(coldX, coldZ, 0);
    assert.ok(engineQueueNames().includes(zoneEntryName), 'real teleport must enqueue the packed cold-zone entry');
    assert.ok(engineQueueNames().includes('[mapzone,0_44_58]'), 'real teleport must enqueue the packed Trollweiss map-zone entry');
    player.processEngineQueue();

    let timer = player.timers.get(timerScript.id);
    assert.ok(timer, 'packed cold-zone entry must arm the real player timer');
    const armedAt = World.currentTick;
    assert.equal(timer.clock, armedAt, 'normal timer clock starts at the tick the packed zone entry arms it');

    World.currentTick = armedAt + drainInterval - 1;
    player.processTimers(normalTimer);
    assert.equal(timer.clock, armedAt, 'chill must not drain before the first interval elapses');
    assert.deepEqual(levels(), expectedLevels(60), 'no stat may drain before the first due tick');
    assert.equal(player.runenergy, 8400, 'energy must remain unchanged before the first due tick');
    assert.equal(queueEntries().length, 0, 'no HP damage may be queued before the first due tick');

    const drainTicks = [];
    for (let drain = 1; drain <= 6; drain++) {
        const dueTick = armedAt + drain * drainInterval;
        const previousLevels = levels();
        const previousClock = armedAt + (drain - 1) * drainInterval;

        World.currentTick = dueTick - 1;
        player.processTimers(normalTimer);
        assert.equal(timer.clock, previousClock, `drain ${drain} must not run one tick early`);
        assert.deepEqual(levels(), previousLevels, `stats must not change before drain ${drain}`);
        assert.equal(queueEntries().length, 0, `HP damage must not be queued before drain ${drain}`);

        World.currentTick = dueTick;
        player.processTimers(normalTimer);
        assert.equal(timer.clock, dueTick, `drain ${drain} must run on its exact 10-tick boundary`);
        drainTicks.push(dueTick);
        const queuedDamage = queueEntries();
        assert.equal(queuedDamage.length, 1, `drain ${drain} must use the real queued HP-damage path`);
        assert.equal(queuedDamage[0].script.name, '[queue,damage_player]', 'HP must be routed through the packed damage queue');
        for (let stat = 0; stat < statCount; stat++) {
            assert.equal(player.levels[stat], stat === hitpoints ? previousLevels[stat] : previousLevels[stat] - 1,
                `stat ${stat} must lose exactly one point on drain ${drain} (HP is queued)`);
        }
        // World processes primary queues before timers. A timer's HP request is
        // therefore handled on the following game tick, not by a second queue pass.
        World.currentTick = dueTick + 1;
        player.processQueues();
        assert.deepEqual(levels(), expectedLevels(60 - drain), `all stats, including queued HP, must drain by tick ${dueTick + 1}`);
        assert.equal(queueEntries().length, 0, `queued HP damage must finish on drain ${drain}`);
        assert.equal(player.runenergy, 0, `packed chill effect must clear run energy on drain ${drain}`);
    }

    assert.equal(drainTicks.length, 6, 'at least six in-cold timer drains are required');
    assert.deepEqual(drainTicks, Array.from({ length: 6 }, (_, index) => armedAt + (index + 1) * drainInterval),
        'six in-cold drains must be exactly 10 ticks apart, starting 10 ticks after arming');

    for (const [step, value] of [[7, 2], [8, 1]]) {
        setAllLevels(value);
        player.runenergy = 2600;
        const dueTick = armedAt + step * drainInterval;
        const previousClock = armedAt + (step - 1) * drainInterval;
        World.currentTick = dueTick - 1;
        player.processTimers(normalTimer);
        assert.equal(timer.clock, previousClock, `floor check ${step} must not run early`);
        assert.deepEqual(levels(), expectedLevels(value), `floor check ${step} must remain unchanged before due time`);
        World.currentTick = dueTick;
        player.processTimers(normalTimer);
        assert.equal(timer.clock, dueTick, `floor check ${step} must still run at the 10-tick interval`);
        if (value > 1) {
            assert.equal(queueEntries().length, 1, 'HP reaching one must still use the queued damage path');
            World.currentTick = dueTick + 1;
            player.processQueues();
        } else {
            assert.equal(queueEntries().length, 0, 'stats at one must not queue further HP damage');
        }
        assert.deepEqual(levels(), expectedLevels(1), 'every one of the 21 stats must stop at level one');
        assert.equal(player.runenergy, 0, 'cold-zone energy clearing must continue at the floor');
    }

    const outsideZoneX = 44 * 64 + 1;
    const outsideZoneZ = 58 * 64 + 40 + 1;
    setAllLevels(25);
    player.runenergy = 5432;
    player.teleport(outsideZoneX, outsideZoneZ, 0);
    assert.ok(engineQueueNames().includes(zoneExitName), 'leaving the cold rectangle must enqueue its packed zone-exit script');
    player.processEngineQueue();
    assert.equal(player.timers.has(timerScript.id), false, 'packed zone exit must clear the real chill timer');

    const afterZoneExit = levels();
    const energyAfterZoneExit = player.runenergy;
    World.currentTick += drainInterval;
    player.processTimers(normalTimer);
    player.processQueues();
    assert.deepEqual(levels(), afterZoneExit, 'zone exit must stop later stat drains');
    assert.equal(player.runenergy, energyAfterZoneExit, 'zone exit must stop later energy clearing');

    const refreshState = ScriptRunner.init(refreshScript, player);
    assert.equal(player.runScript(refreshState, true, true), ScriptState.FINISHED, 'packed refresh proc must arm a timer outside the effect table');
    timer = player.timers.get(timerScript.id);
    assert.ok(timer, 'outside-table regression requires an actually armed timer');
    const outsideArmTick = World.currentTick;
    assert.equal(timer.clock, outsideArmTick, 'outside timer must start at its real arming tick');
    setAllLevels(30);
    player.runenergy = 4321;
    const outsideLevels = levels();

    World.currentTick = outsideArmTick + drainInterval - 1;
    player.processTimers(normalTimer);
    assert.equal(timer.clock, outsideArmTick, 'outside-table timer must respect the same no-early interval');
    assert.deepEqual(levels(), outsideLevels, 'outside-table player must not drain early');
    assert.equal(player.runenergy, 4321, 'outside-table player energy must not change early');

    World.currentTick = outsideArmTick + drainInterval;
    player.processTimers(normalTimer);
    assert.equal(timer.clock, outsideArmTick + drainInterval, 'armed timer must execute at its due tick outside the effect table');
    assert.deepEqual(levels(), outsideLevels, 'timer execution outside the cold effect table must not drain any stat');
    assert.equal(queueEntries().length, 0, 'outside-table timer must not queue HP damage');
    assert.equal(player.runenergy, 4321, 'outside-table timer must not clear energy');

    const beforeMapExitTick = World.currentTick;
    player.teleport(45 * 64 + 1, outsideZoneZ, 0);
    assert.ok(engineQueueNames().includes(mapZoneExitName), 'crossing the mapsquare must enqueue the packed map-zone exit');
    player.processEngineQueue();
    assert.equal(player.timers.has(timerScript.id), false, 'packed map-zone exit must clear the real chill timer');

    const afterMapExit = levels();
    const energyAfterMapExit = player.runenergy;
    World.currentTick = beforeMapExitTick + drainInterval;
    player.processTimers(normalTimer);
    player.processQueues();
    assert.deepEqual(levels(), afterMapExit, 'map-zone exit must stop later stat drains');
    assert.equal(player.runenergy, energyAfterMapExit, 'map-zone exit must stop later energy clearing');

    console.log(`PASS packed chill: six in-cold drains at ticks ${drainTicks.join(', ')}, all 21 stats and the level-one floor, queued HP damage, energy clearing, zone/map exits, and outside-table no-effect`);
    console.log('ENGINE FIRST-DRAIN SEMANTICS: Player.setTimer records World.currentTick when armed; processTimers first runs when World.currentTick >= timer.clock + interval, so the first chill stat drain is exactly 10 ticks after arming; queued HP follows on the next tick.');
} catch (error) {
    console.error(error);
    exitCode = 1;
} finally {
    if (World && originalTick !== undefined) World.currentTick = originalTick;
    if (World && playerSlot > 0) World.players[playerSlot] = previousSlotPlayer;
    if (player) player.cleanup();
    process.exit(exitCode);
}
