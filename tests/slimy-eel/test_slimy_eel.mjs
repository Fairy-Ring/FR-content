#!/usr/bin/env node
/** Exercise the published packed scripts and map data without starting a server. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine');
const initialCwd = process.cwd();
const packFlag = process.argv.findIndex(arg => arg === '--pack' || arg.startsWith('--pack='));
let requestedPack = null;
if (packFlag !== -1) {
    const flag = process.argv[packFlag];
    requestedPack = flag.startsWith('--pack=') ? flag.slice('--pack='.length) : process.argv[packFlag + 1];
    assert(requestedPack && !requestedPack.startsWith('--'), 'usage: test_slimy_eel.mjs [--pack <pack-directory>]');
}
const packDir = path.resolve(initialCwd, requestedPack ?? path.join(engineRoot, 'data/pack'));
const load = async relative => import(pathToFileURL(path.join(engineRoot, relative)).href);
const readHash = relative => {
    const filename = path.join(packDir, relative);
    return existsSync(filename) ? createHash('sha256').update(readFileSync(filename)).digest('hex') : null;
};
const maybeRead = relative => {
    const filename = path.join(packDir, relative);
    return existsSync(filename) ? readFileSync(filename) : null;
};

assert(existsSync(path.join(packDir, 'server/script.dat')), `missing packed scripts: ${packDir}`);
const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const { ScriptOpcode } = await load('src/engine/script/ScriptOpcode.ts');
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const PlayerModule = await load('src/engine/entity/Player.ts');
const Player = PlayerModule.default;
const { getExpByLevel } = PlayerModule;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const CoordGrid = (await load('src/engine/CoordGrid.ts')).CoordGrid;
const { CollisionFlag, isFlagged } = await load('src/engine/routefinder/index.ts');
const { isZoneAllocated } = await load('src/engine/GameMap.ts');
const MoveClick = (await load('src/network/game/client/model/MoveClick.ts')).default;
const MoveClickHandler = (await load('src/network/game/client/handler/MoveClickHandler.ts')).default;

assert.equal(Environment.NODE_PRODUCTION, false, 'run with the non-production ScriptRunner policy');
assert.equal(Environment.NODE_XPRATE, 1, 'the oracle expects unmultiplied XP in tenths');
const configs = {};
for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'ObjType', 'LocType', 'NpcType',
    'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'FloType', 'MesanimType',
    'DbTableType', 'DbRowType', 'Component', 'FontType'
]) {
    configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
    configs[name].load(packDir);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(packDir) > 0, `no packed scripts loaded from ${packDir}`);

const {
    VarPlayerType, ParamType, ObjType, NpcType, InvType, CategoryType, EnumType, StructType, SeqType, FloType
} = configs;
const packHashes = {};
for (const relative of [
    'server/script.dat', 'server/script.idx', 'server/npc.dat', 'server/npc.idx',
    'server/obj.dat', 'server/obj.idx', 'server/param.dat', 'server/param.idx',
    'server/category.dat', 'server/category.idx', 'server/enum.dat', 'server/enum.idx',
    'server/struct.dat', 'server/struct.idx', 'server/flo.dat', 'client/config/flo.dat', '.cache/maps-server.zip'
]) {
    packHashes[relative] = readHash(relative);
}
console.log(`PACK ${JSON.stringify({ pack: path.basename(packDir), hashes: packHashes })}`);

const namedId = (type, name, label = name) => {
    const id = type.getId(name);
    assert(id >= 0, `missing packed ${label}`);
    return id;
};
const ids = {
    inv: namedId(InvType, 'inv'),
    rod: namedId(ObjType, 'fishing_rod'),
    bait: namedId(ObjType, 'fishing_bait'),
    net: namedId(ObjType, 'net'),
    logs: namedId(ObjType, 'logs'),
    fish: namedId(ObjType, 'mort_slimey_eel'),
    movement: namedId(ParamType, 'fishing_movement_enum'),
    fishingStruct: namedId(ParamType, 'fishing_struct'),
    actionDelay: namedId(VarPlayerType, 'action_delay'),
    slimeyfish: CategoryType.getId('slimeyfish'),
    freshfish: CategoryType.getId('freshfish'),
    fishingStat: PlayerStat.FISHING
};

const eelSpecs = [
    { name: '0_54_53_slimey_eel', movement: 'fishing_movement_slimey_eel_east_enum' },
    { name: '0_53_53_slimey_eel', movement: 'fishing_movement_slimey_eel_west_enum' },
    { name: '0_53_51_slimey_eel', movement: 'fishing_movement_slimey_eel_south_enum' }
];
const eelTypes = eelSpecs.map(spec => ({ ...spec, type: NpcType.getByName(spec.name) }));
const opSpecs = [
    { trigger: ServerTriggerType.OPNPC1, name: '[opnpc1,_slimeyfish]' },
    { trigger: ServerTriggerType.OPNPC3, name: '[opnpc3,_slimeyfish]' },
    { trigger: ServerTriggerType.OPNPCU, name: '[opnpcu,_slimeyfish]' },
    { trigger: ServerTriggerType.AI_TIMER, name: '[ai_timer,_slimeyfish]' }
];
const attemptLabel = ScriptProvider.getByName('[label,attempt_fish_slimey_eel]');
const fishLabel = ScriptProvider.getByName('[label,fish_slimey_eel]');
const fishRollScript = ScriptProvider.getByName('[proc,fish_roll]');
const expectedStructId = StructType.getId('fishing_struct_mort_slimey_eel');
const expectedMessage = 'You catch a slimy swamp eel.';
const controlType = NpcType.getByName('0_35_50_freshfish');
const controlScriptNames = new Set(opSpecs.map(spec => spec.name));
const seqName = id => SeqType.get(id)?.debugname ?? null;
const expectedMessages = {
    level: 'You need at least 28 Fishing to catch these fish.',
    rod: 'You need a Fishing Rod to bait these fish.',
    bait: "You don't have any fishing bait left.",
    wrongTool: 'There is nothing suitable for catching with a net here.',
    full: "You can't carry any more fish."
};
// preserved donor enum tiles with no free cardinal bank on the 377 map; U-SLIMYEEL-1113 ruling 3
const preservedUnreachableTiles = ['0_3432_3405', '0_3440_3282', '0_3444_3280', '0_3439_3284'].sort();

let caseNumber = 0;
let failed = 0;
function runCase(name, body) {
    const checks = [];
    let details;
    const ctx = {
        check(label, actual, expected) {
            const pass = JSON.stringify(actual) === JSON.stringify(expected);
            checks.push({ label, actual, expected, pass });
        },
        detail(value) { details = value; },
        fail(label, error) {
            checks.push({ label, actual: error?.stack ?? String(error), expected: 'no exception', pass: false });
        }
    };
    try {
        body(ctx);
    } catch (error) {
        ctx.fail('case execution', error);
    }
    const pass = checks.length > 0 && checks.every(check => check.pass);
    if (!pass) failed++;
    console.log(`CASE ${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify({ checks, ...(details === undefined ? {} : { details }) })}`);
    caseNumber++;
    return pass;
}

const toCoord = value => CoordGrid.unpackCoord(Number(value));
const packMapZip = maybeRead('.cache/maps-server.zip');
const collisionMapZip = readFileSync(path.join(engineRoot, 'data/pack/.cache/maps-server.zip'));
const sameMapArchive = packMapZip && createHash('sha256').update(packMapZip).digest('hex') === createHash('sha256').update(collisionMapZip).digest('hex');
let selectedMapEntries = null;
if (packMapZip && !sameMapArchive) {
    const engineRequire = createRequire(path.join(engineRoot, 'package.json'));
    const { unzipSync } = engineRequire('fflate');
    selectedMapEntries = unzipSync(packMapZip);
}
const decodedMaps = new Map();
function packedMap(level, x, z) {
    const mx = x >> 6;
    const mz = z >> 6;
    const key = (mx << 8) | mz;
    if (!decodedMaps.has(key)) {
        let bytes;
        if (sameMapArchive) {
            bytes = World.gameMap['packed']?.get(key)?.m;
        } else if (selectedMapEntries) {
            bytes = selectedMapEntries[`m${mx}_${mz}`];
        } else {
            const filename = path.join(packDir, 'server/maps', `m${mx}_${mz}`);
            bytes = existsSync(filename) ? readFileSync(filename) : null;
        }
        if (!bytes) {
            decodedMaps.set(key, null);
        } else {
            const floors = new Array(4 * 64 * 64);
            let offset = 0;
            for (let plane = 0; plane < 4; plane++) {
                for (let localX = 0; localX < 64; localX++) {
                    for (let localZ = 0; localZ < 64; localZ++) {
                        let overlay = -1;
                        let underlay = -1;
                        for (;;) {
                            const opcode = bytes[offset++];
                            if (opcode === 0) break;
                            if (opcode === 1) {
                                offset++;
                                break;
                            }
                            if (opcode <= 49) overlay = bytes[offset++];
                            else if (opcode > 81) underlay = opcode - 81;
                        }
                        floors[(plane * 64 + localX) * 64 + localZ] = { overlay, underlay };
                    }
                }
            }
            decodedMaps.set(key, floors);
        }
    }
    const floors = decodedMaps.get(key);
    if (!floors) return null;
    const index = (level * 64 + (x & 63)) * 64 + (z & 63);
    const idsAtTile = floors[index];
    const floorIds = [
        idsAtTile.overlay > 0 ? idsAtTile.overlay - 1 : -1,
        idsAtTile.underlay > 0 ? idsAtTile.underlay - 1 : -1
    ];
    const names = floorIds
        .filter(id => id >= 0)
        .map(id => FloType.get(id)?.debugname?.toLowerCase() ?? null);
    return { ids: idsAtTile, names };
}
const waterNames = new Set([
    'water', 'gungywater', 'water_no_texture', 'gungywater_no_texture', 'contact_dungeon_water',
    'dwarf_glacial_water', 'mdaugher_water', 'dagganoth_cave_water', 'elid_underground_water'
]);
const isWater = tile => Boolean(tile?.names.some(name => waterNames.has(name)));
const hasLandFloor = tile => Boolean(tile?.names.some(name => name !== null && !waterNames.has(name)));
const walkableLand = coord => {
    const floor = packedMap(coord.level, coord.x, coord.z);
    // A shoreline tile can have both a water overlay and a land underlay.
    return hasLandFloor(floor) && isZoneAllocated(coord.level, coord.x, coord.z) &&
        !isFlagged(coord.x, coord.z, coord.level, CollisionFlag.WALK_BLOCKED);
};
const neighbors = (coord) => {
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx || dz) out.push({ level: coord.level, x: coord.x + dx, z: coord.z + dz });
        }
    }
    return out;
};
let probeSerial = 0;
function makePlayer(level = 28) {
    const slot = ++probeSerial;
    const hash = BigInt(1000 + slot);
    const player = new Player(`slimeyeel${slot}`, hash, hash);
    player.slot = slot;
    player.pid = slot;
    player.uid = ((Number(hash & 0x1fffffn) << 11) | slot) >>> 0;
    player.vars.fill(0);
    player.setVar(ids.actionDelay, 0);
    player.stats.fill(0);
    player.levels.fill(1);
    player.baseLevels.fill(1);
    player.stats[ids.fishingStat] = getExpByLevel(level);
    player.levels[ids.fishingStat] = level;
    player.baseLevels[ids.fishingStat] = level;
    player.lowMemory = false;
    const trace = { messages: [], interfaceText: [], animations: [], sounds: [], fishRollCalls: 0, opcodes: {} };
    const originalMessage = player.messageGame.bind(player);
    player.messageGame = text => {
        trace.messages.push(String(text));
        return originalMessage(text);
    };
    const originalAnimation = player.playAnimation.bind(player);
    player.playAnimation = (sequence, delay) => {
        trace.animations.push(seqName(sequence));
        return originalAnimation(sequence, delay);
    };
    player.write = packet => {
        const packetName = packet?.constructor?.name ?? '';
        if (packetName === 'SynthSound') trace.sounds.push({ synth: packet.synth, loops: packet.loops, delay: packet.delay });
        if (packetName === 'IfSetText' && typeof packet.text === 'string') trace.interfaceText.push(packet.text);
    };
    return { player, trace };
}
function makeNpc(type, coord, lifecycle = EntityLifeCycle.DESPAWN) {
    const nid = World.npcs.next();
    return new Npc(coord.level, coord.x, coord.z, type.size, type.size, lifecycle, nid, type.id, type.blockwalk);
}
function activateNpc(npc) {
    World.addNpc(npc, -1);
    return npc;
}
function disposeNpc(npc) {
    if (npc?.isActive) World.removeNpc(npc, -1);
}
function enumFor(type) {
    const enumId = type?.params?.get(ids.movement);
    return enumId === undefined || enumId === null ? null : EnumType.get(enumId);
}
function enumCoords(type) {
    const enumType = enumFor(type);
    if (!enumType?.values) return [];
    return [...enumType.values.entries()]
        .sort(([left], [right]) => left - right)
        .map(([key, value]) => ({ key, coord: toCoord(value) }));
}
function findApproach(type, coord) {
    const npc = new Npc(coord.level, coord.x, coord.z, type.size, type.size, EntityLifeCycle.DESPAWN, 0, type.id, type.blockwalk);
    const player = makePlayer(28).player;
    for (const candidate of neighbors(coord)) {
        if (!walkableLand(candidate)) continue;
        player.level = candidate.level;
        player.x = candidate.x;
        player.z = candidate.z;
        if (player.inOperableDistance(npc)) return candidate;
    }
    return null;
}
function reachableFishingFixture(type) {
    for (const { coord } of enumCoords(type)) {
        const approach = findApproach(type, coord);
        if (approach) return { coord, approach };
    }
    throw new Error(`no operable bank beside any enum tile for ${type.debugname}`);
}
function dataForType(type) {
    return enumCoords(type).map(({ key, coord }) => {
        const floor = packedMap(coord.level, coord.x, coord.z);
        const approach = findApproach(type, coord);
        return {
            key,
            coord: `${coord.level}_${coord.x}_${coord.z}`,
            floor: floor?.names ?? null,
            water: isWater(floor),
            approach: approach ? `${approach.level}_${approach.x}_${approach.z}` : null,
            adjacent: approach ? undefined : neighbors(coord).map(tile => ({
                coord: `${tile.level}_${tile.x}_${tile.z}`,
                floor: packedMap(tile.level, tile.x, tile.z)?.names ?? null,
                allocated: isZoneAllocated(tile.level, tile.x, tile.z),
                water: isWater(packedMap(tile.level, tile.x, tile.z)),
                blocked: isFlagged(tile.x, tile.z, tile.level, CollisionFlag.WALK_BLOCKED)
            }))
        };
    });
}

const handlerRestores = [];
let activeWatch = null;
function observeOpcode(opcode, label, record) {
    const original = ScriptRunner.HANDLERS[opcode];
    assert.equal(typeof original, 'function', `missing ScriptRunner handler ${label}`);
    ScriptRunner.HANDLERS[opcode] = state => {
        if (activeWatch && record(state, activeWatch)) {
            activeWatch.trace.opcodes[label] = (activeWatch.trace.opcodes[label] ?? 0) + 1;
        }
        return original(state);
    };
    handlerRestores.push(() => { ScriptRunner.HANDLERS[opcode] = original; });
}
const activePlayer = state => state._activePlayer === activeWatch?.player;
const activeNpc = state => state._activeNpc === activeWatch?.npc;
observeOpcode(ScriptOpcode.GOSUB, 'GOSUB', state => {
    if (!activePlayer(state)) return false;
    const called = ScriptProvider.get(state.intStack[state.isp - 1]);
    if (called?.id !== fishRollScript?.id) return false;
    activeWatch.trace.fishRollCalls++;
    return true;
});
observeOpcode(ScriptOpcode.GOSUB_WITH_PARAMS, 'GOSUB_WITH_PARAMS', state => {
    if (!activePlayer(state)) return false;
    const called = ScriptProvider.get(state.intOperand);
    if (called?.id !== fishRollScript?.id) return false;
    activeWatch.trace.fishRollCalls++;
    return true;
});
for (const [opcode, label] of [
    [ScriptOpcode.NPC_DELAY, 'NPC_DELAY'],
    [ScriptOpcode.NPC_TELE, 'NPC_TELE'],
    [ScriptOpcode.NPC_SETTIMER, 'NPC_SETTIMER']
]) {
    observeOpcode(opcode, label, activeNpc);
}
function withWatch(watch, body) {
    const previous = activeWatch;
    activeWatch = watch;
    try { return body(); }
    finally { activeWatch = previous; }
}
function withRandom(draw, body) {
    const original = JavaRandom.nextDouble;
    JavaRandom.nextDouble = draw;
    try { return body(); }
    finally { JavaRandom.nextDouble = original; }
}
function placePlayerForTarget(player, npc, op) {
    player.target = npc;
    player.targetSubject.type = npc.type;
    player.targetSubject.com = -1;
    player.targetOp = op - 7;
}
function interactTick(player, trace, tick) {
    World.currentTick = tick;
    player.resetEntity(false);
    const trigger = player.getOpTrigger();
    const before = {
        messages: trace.messages.length,
        interfaceText: trace.interfaceText.length,
        animations: trace.animations.length,
        sounds: trace.sounds.length,
        fishRollCalls: trace.fishRollCalls
    };
    withWatch({ player, trace }, () => player.processInteraction());
    return {
        tick,
        trigger: trigger?.name ?? null,
        handled: trigger !== null,
        actionDelay: player.getVar(ids.actionDelay),
        messages: trace.messages.slice(before.messages),
        interfaceText: trace.interfaceText.slice(before.interfaceText),
        animations: trace.animations.slice(before.animations),
        sounds: trace.sounds.length - before.sounds,
        soundEvents: trace.sounds.slice(before.sounds),
        fishRollCalls: trace.fishRollCalls - before.fishRollCalls
    };
}
function itemCount(player, id) {
    return player.getInventory(ids.inv).getItemCount(id);
}
function inventorySnapshot(player) {
    return player.getInventory(ids.inv).items
        .filter(item => item && item.id >= 0 && item.count > 0)
        .map(item => ({ name: ObjType.get(item.id)?.debugname ?? String(item.id), count: item.count }))
        .sort((left, right) => left.name.localeCompare(right.name) || left.count - right.count);
}
function equip(player, { rod = true, bait = 3, net = false, freeSlots = 0 } = {}) {
    const inventory = player.getInventory(ids.inv);
    const capacity = inventory.capacity;
    assert(capacity >= 4, `inventory capacity too small for fixture: ${capacity}`);
    inventory.set(0, { id: rod ? ids.rod : ids.net, count: 1 });
    if (bait > 0) inventory.set(1, { id: ids.bait, count: bait });
    if (net) player.lastUseItem = ids.net;
    else if (rod) player.lastUseItem = ids.rod;
    let slot = bait > 0 ? 2 : 1;
    const occupiedLimit = capacity - freeSlots;
    while (slot < occupiedLimit) inventory.set(slot++, { id: ids.logs, count: 1 });
    return inventory;
}
function setNpcActionTarget(player, npc, op) {
    placePlayerForTarget(player, npc, op);
}
function performAction(type, options, lastTick) {
    const { coord, approach } = reachableFishingFixture(type);
    const npc = activateNpc(makeNpc(type, coord));
    const { player, trace } = makePlayer(options.level ?? 28);
    player.level = approach.level;
    player.x = approach.x;
    player.z = approach.z;
    equip(player, options.inventory);
    if (options.lastUseItem !== undefined) player.lastUseItem = options.lastUseItem;
    setNpcActionTarget(player, npc, options.op ?? ServerTriggerType.OPNPC1);
    const startTick = options.startTick ?? 100 + caseNumber * 20;
    const frames = [];
    try {
        withRandom(() => options.random ?? 0, () => {
            for (let offset = 0; offset <= lastTick; offset++) {
                frames.push(interactTick(player, trace, startTick + offset));
            }
        });
        return { player, npc, trace, frames, startTick };
    } finally {
        disposeNpc(npc);
    }
}
function frameAt(result, offset) {
    return result.frames.find(frame => frame.tick === result.startTick + offset);
}

// The collision world is loaded by the engine from its sibling pack. Map-floor
// bytes below come from the selected pack; a content-only change must not alter maps.
process.chdir(engineRoot);
World.gameMap.init();
console.log(`MAP ${JSON.stringify({ selected: readHash('.cache/maps-server.zip'), collision: createHash('sha256').update(collisionMapZip).digest('hex'), sameArchive: Boolean(sameMapArchive) })}`);

runCase('packed-trigger-dispatch', ctx => {
    ctx.check('slimeyfish category exists', ids.slimeyfish >= 0, true);
    ctx.check('attempt label packed', attemptLabel?.name ?? null, '[label,attempt_fish_slimey_eel]');
    ctx.check('fish label packed', fishLabel?.name ?? null, '[label,fish_slimey_eel]');
    ctx.check('fish_roll proc packed', fishRollScript?.name ?? null, '[proc,fish_roll]');
    for (const { name, type } of eelTypes) {
        ctx.check(`${name} exists`, type?.debugname ?? null, name);
        if (!type) continue;
        ctx.check(`${name} category`, type.category, ids.slimeyfish);
        ctx.check(`${name} timer`, type.timer, 1);
        ctx.check(`${name} bait option`, type.op?.[0] ?? null, 'Bait');
        ctx.check(`${name} internal operation 3`, type.op?.[2] ?? null, 'hidden');
        ctx.check(`${name} internal operation 5`, type.op?.[4] ?? null, 'hidden');
        ctx.check(`${name} movement enum`, EnumType.get(type.params?.get(ids.movement))?.debugname ?? null, name === eelSpecs[0].name ? eelSpecs[0].movement : name === eelSpecs[1].name ? eelSpecs[1].movement : eelSpecs[2].movement);
        for (const spec of opSpecs) {
            const script = ScriptProvider.getByTrigger(spec.trigger, type.id, type.category);
            ctx.check(`${name} ${spec.name}`, script?.name ?? null, spec.name);
        }
    }
    ctx.check('movement helper label packed', ScriptProvider.getByName('[label,move_fishing_spot]')?.name ?? null, '[label,move_fishing_spot]');
});

runCase('slimy-eel-object-fishing-struct', ctx => {
    const object = ObjType.get(ids.fish);
    const structParam = object?.params?.get(ids.fishingStruct);
    const struct = structParam === undefined || structParam === null ? null : StructType.get(structParam);
    const paramValue = name => {
        const id = ParamType.getId(name);
        return id < 0 ? null : struct?.params?.get(id) ?? null;
    };
    const observed = {
        object: object?.debugname ?? null,
        structParam: structParam ?? null,
        structName: struct?.debugname ?? null,
        productExperience: paramValue('productexp'),
        successLow: paramValue('success_low'),
        successHigh: paramValue('success_high'),
        productMessage: paramValue('productmessage')
    };
    ctx.check('object is packed slimy eel', observed.object, 'mort_slimey_eel');
    ctx.check('object points to named eel struct', observed.structName, 'fishing_struct_mort_slimey_eel');
    ctx.check('object param uses named struct ID', structParam, expectedStructId);
    ctx.check('product experience', observed.productExperience, 650);
    ctx.check('success low', observed.successLow, 10);
    ctx.check('success high', observed.successHigh, 80);
    ctx.check('period-candidate catch message', observed.productMessage, expectedMessage);
    ctx.detail(observed);
});

runCase('fishing-enum-water-and-operable-bank', ctx => {
    const failures = [];
    const tileDetails = {};
    for (const { name, type } of eelTypes) {
        const rows = type ? dataForType(type) : [];
        tileDetails[name] = rows;
        if (!rows.length) failures.push({ type: name, tile: null, reason: 'movement enum missing or empty' });
        for (const row of rows) {
            if (!row.water) failures.push({ type: name, tile: row.coord, reason: 'enum tile is not a recognized water floor', floor: row.floor });
            if (!row.approach) failures.push({ type: name, tile: row.coord, reason: 'no adjacent walkable land tile passes Player.inOperableDistance', floor: row.floor });
        }
    }
    const bankReason = 'no adjacent walkable land tile passes Player.inOperableDistance';
    ctx.check('all enum tiles retain their water data', failures.filter(failure => failure.reason !== bankReason), []);
    ctx.check('only the preserved donor tiles lack a free cardinal bank', failures.filter(failure => failure.reason === bankReason).map(failure => failure.tile).sort(), preservedUnreachableTiles);
    ctx.detail(tileDetails);
});

runCase('fishing-category-controls', ctx => {
    ctx.check('freshfish control exists', controlType?.debugname ?? null, '0_35_50_freshfish');
    ctx.check('freshfish category exists', ids.freshfish >= 0, true);
    if (controlType) {
        ctx.check('control retains its published category', controlType.category, ids.freshfish);
        for (const spec of opSpecs) {
            const script = ScriptProvider.getByTrigger(spec.trigger, controlType.id, controlType.category);
            ctx.check(`control does not resolve ${spec.name}`, controlScriptNames.has(script?.name) ? script.name : null, null);
        }
    }
    const categoryControls = ['freshfish', 'saltfish', 'rarefish', 'memberfish'];
    const categoryResults = [];
    for (const categoryName of categoryControls) {
        const categoryId = CategoryType.getId(categoryName);
        const type = categoryId < 0 ? null : Array.from({ length: NpcType.count }, (_, id) => NpcType.get(id)).find(candidate => candidate?.category === categoryId);
        if (!type) {
            categoryResults.push({ category: categoryName, type: null, routes: null });
            continue;
        }
        const routes = opSpecs.map(spec => ({ trigger: spec.name, script: ScriptProvider.getByTrigger(spec.trigger, type.id, type.category)?.name ?? null }));
        categoryResults.push({ category: categoryName, type: type.debugname, routes });
        for (const route of routes) ctx.check(`${categoryName} ${route.trigger} is not an eel route`, controlScriptNames.has(route.script) ? route.script : null, null);
    }
    const lavaType = Array.from({ length: NpcType.count }, (_, id) => NpcType.get(id))
        .find(type => /lava/i.test(type?.debugname ?? '') && type?.category !== ids.slimeyfish);
    if (lavaType) {
        for (const spec of opSpecs) {
            const script = ScriptProvider.getByTrigger(spec.trigger, lavaType.id, lavaType.category);
            ctx.check(`lava control does not resolve ${spec.name}`, controlScriptNames.has(script?.name) ? script.name : null, null);
        }
    }
    ctx.detail({ categories: categoryResults, lavaType: lavaType?.debugname ?? null });
});

runCase('level-rod-bait-and-wrong-tool-validation', ctx => {
    const scenarios = [
        { name: 'level gate', options: { level: 27, inventory: { rod: true, bait: 2 } }, message: expectedMessages.level },
        { name: 'missing rod', options: { inventory: { rod: false, bait: 2 } }, message: expectedMessages.rod },
        { name: 'missing bait', options: { inventory: { rod: true, bait: 0 } }, message: expectedMessages.bait },
        { name: 'wrong net', options: { op: ServerTriggerType.OPNPCU, inventory: { rod: false, bait: 0, net: true }, lastUseItem: ids.net }, message: expectedMessages.wrongTool }
    ];
    const observed = [];
    for (const { name, type } of eelTypes) {
        assert(type, `missing ${name}`);
        for (const scenario of scenarios) {
            const result = performAction(type, scenario.options, 0);
            const text = result.trace.messages.concat(result.trace.interfaceText);
            observed.push({ type: name, name: scenario.name, trigger: result.frames[0]?.trigger ?? null, text });
            ctx.check(`${name} ${scenario.name} is visible`, text.includes(scenario.message), true);
            ctx.check(`${name} ${scenario.name} does not run fish_roll`, result.trace.fishRollCalls, 0);
        }
    }
    ctx.detail(observed);
});

runCase('tick-by-tick-fishing-catch-and-repeat', ctx => {
    const traces = [];
    for (const { name, type } of eelTypes) {
        if (!type) throw new Error(`missing ${name}`);
        const result = performAction(type, { inventory: { rod: true, bait: 3, freeSlots: 2 } }, 10);
        const frames = result.frames;
        const triggerNames = frames.map(frame => frame.trigger);
        const expectedTriggers = [
            '[opnpc1,_slimeyfish]', '[opnpc1,_slimeyfish]', '[opnpc1,_slimeyfish]',
            '[opnpc3,_slimeyfish]', '[opnpc3,_slimeyfish]', '[opnpc3,_slimeyfish]',
            '[opnpc3,_slimeyfish]', '[opnpc3,_slimeyfish]', '[opnpc3,_slimeyfish]',
            '[opnpc3,_slimeyfish]', '[opnpc3,_slimeyfish]'
        ];
        ctx.check(`${name} ScriptRunner trigger sequence`, triggerNames, expectedTriggers);
        ctx.check(`${name} action-delay sequence`, frames.map(frame => frame.actionDelay - result.startTick), [5, 5, 5, 5, 5, 5, 10, 10, 10, 10, 10]);
        ctx.check(`${name} cast at tick +1`, frameAt(result, 1).messages, ['You cast out your line...']);
        ctx.check(`${name} cast animation at tick +1`, frameAt(result, 1).animations, ['human_fishing_casting']);
        ctx.check(`${name} attempt and sound at tick +2`, frameAt(result, 2).messages, ['You attempt to catch a fish.']);
        ctx.check(`${name} cast sound at tick +2`, frameAt(result, 2).sounds, 1);
        ctx.check(`${name} sound parameters at tick +2`, frameAt(result, 2).soundEvents.map(({ loops, delay }) => [loops, delay]), [[1, 0]]);
        ctx.check(`${name} first fish_roll at tick +5`, frameAt(result, 5).fishRollCalls, 1);
        ctx.check(`${name} second fish_roll at tick +10`, frameAt(result, 10).fishRollCalls, 1);
        ctx.check(`${name} bait consumed once per catch`, [itemCount(result.player, ids.bait), 3 - itemCount(result.player, ids.bait)], [1, 2]);
        ctx.check(`${name} fish count after two catches`, itemCount(result.player, ids.fish), 2);
        ctx.check(`${name} fishing XP after two catches`, result.player.stats[ids.fishingStat] - getExpByLevel(28), 1300);
        ctx.check(`${name} success message count`, result.trace.messages.concat(result.trace.interfaceText).filter(text => text === expectedMessage).length, 2);
        traces.push({ name, frames, inventory: inventorySnapshot(result.player), xp: result.player.stats[ids.fishingStat] - getExpByLevel(28) });
    }
    ctx.detail(traces);
});

runCase('failed-fish-roll-consumes-no-bait-or-fish', ctx => {
    const observed = [];
    for (const { name, type } of eelTypes) {
        assert(type, `missing ${name}`);
        const result = performAction(type, { inventory: { rod: true, bait: 3, freeSlots: 2 }, random: 0.999999 }, 5);
        ctx.check(`${name} fish_roll reached at the scheduled tick`, frameAt(result, 5).fishRollCalls, 1);
        ctx.check(`${name} failed roll does not consume bait`, itemCount(result.player, ids.bait), 3);
        ctx.check(`${name} failed roll does not add eel`, itemCount(result.player, ids.fish), 0);
        ctx.check(`${name} failed roll grants no fishing XP`, result.player.stats[ids.fishingStat] - getExpByLevel(28), 0);
        observed.push({ name, frames: result.frames, inventory: inventorySnapshot(result.player) });
    }
    ctx.detail(observed);
});

runCase('full-inventory-and-last-bait-branches', ctx => {
    const observed = [];
    for (const { name, type } of eelTypes) {
        assert(type, `missing ${name}`);
        const alreadyFull = performAction(type, { inventory: { rod: true, bait: 2, freeSlots: 0 } }, 0);
        const alreadyFullText = alreadyFull.trace.messages.concat(alreadyFull.trace.interfaceText);
        ctx.check(`${name} full bag with spare bait stops with message`, alreadyFullText.includes(expectedMessages.full), true);
        ctx.check(`${name} full bag prevents fish_roll`, alreadyFull.trace.fishRollCalls, 0);

        const lastBait = performAction(type, { inventory: { rod: true, bait: 1, freeSlots: 0 } }, 6);
        const lastBaitText = lastBait.trace.messages.concat(lastBait.trace.interfaceText);
        ctx.check(`${name} one bait fits the packed-full-bag exception`, frameAt(lastBait, 5).fishRollCalls, 1);
        ctx.check(`${name} last bait is consumed`, itemCount(lastBait.player, ids.bait), 0);
        ctx.check(`${name} last-bait catch adds eel`, itemCount(lastBait.player, ids.fish), 1);
        ctx.check(`${name} last-bait exception does not report full bag`, lastBaitText.includes(expectedMessages.full), false);
        ctx.check(`${name} last-bait exhaustion reports published message`, lastBaitText.includes(expectedMessages.bait), true);

        const fillsAfterCatch = performAction(type, { inventory: { rod: true, bait: 3, freeSlots: 1 } }, 6);
        ctx.check(`${name} catch fills the final slot`, itemCount(fillsAfterCatch.player, ids.fish), 1);
        ctx.check(`${name} next tick stops at full inventory`, frameAt(fillsAfterCatch, 6).messages.concat(frameAt(fillsAfterCatch, 6).interfaceText).includes(expectedMessages.full), true);
        ctx.check(`${name} full bag stops another fish_roll`, fillsAfterCatch.trace.fishRollCalls, 1);

        const exhausted = performAction(type, { inventory: { rod: true, bait: 1, freeSlots: 2 } }, 6);
        ctx.check(`${name} real catch consumes the final bait`, itemCount(exhausted.player, ids.bait), 0);
        ctx.check(`${name} real catch is retained after exhaustion`, itemCount(exhausted.player, ids.fish), 1);
        ctx.check(`${name} exhaustion stops at published message`, exhausted.trace.messages.concat(exhausted.trace.interfaceText).includes(expectedMessages.bait), true);
        observed.push({ name, full: alreadyFullText, lastBait: lastBait.frames, fullAfterCatch: fillsAfterCatch.frames, exhausted: exhausted.frames });
    }
    ctx.detail(observed);
});

runCase('rod-use-dispatches-to-bait-operation', ctx => {
    const observed = [];
    for (const { name, type } of eelTypes) {
        assert(type, `missing ${name}`);
        const result = performAction(type, { op: ServerTriggerType.OPNPCU, inventory: { rod: true, bait: 2, freeSlots: 2 } }, 1);
        ctx.check(`${name} rod use resolves OPNPCU`, result.frames[0].trigger, '[opnpcu,_slimeyfish]');
        ctx.check(`${name} rod use queues operation 1`, result.player.targetOp, ServerTriggerType.APNPC1);
        ctx.check(`${name} queued bait operation runs next tick`, result.frames[1].trigger, '[opnpc1,_slimeyfish]');
        ctx.check(`${name} queued bait operation starts five-tick action`, result.frames[1].actionDelay, result.startTick + 1 + 5);
        observed.push({ name, frames: result.frames });
    }
    ctx.detail(observed);
});

function freeEnumTiles(type) {
    return enumCoords(type).filter(({ coord }) => World.gameMap.hasZone(coord.x, coord.z, coord.level) &&
        !Array.from(World.npcs).some(npc => {
            if (!npc?.isActive || npc.level !== coord.level || npc.x !== coord.x || npc.z !== coord.z) return false;
            return NpcType.get(npc.type)?.category === ids.slimeyfish;
        }));
}
function candidateFraction(index, length) {
    return (index + 0.25) / length;
}
function runMovement(type, targetIndex, blockerType, timerRandom, startTick) {
    const enumValues = enumCoords(type);
    const available = freeEnumTiles(type);
    const candidateEntry = available.find(entry => entry.key === targetIndex) ?? available[0];
    const homeEntry = available.find(entry => entry.key !== candidateEntry?.key);
    if (!candidateEntry || !homeEntry) return null;
    const targetCoord = candidateEntry.coord;
    const homeCoord = homeEntry.coord;
    const trace = { entries: [], frames: [], opcodes: {}, messages: [], interfaceText: [], animations: [], sounds: [], fishRollCalls: 0 };
    const npc = activateNpc(makeNpc(type, homeCoord));
    const blocker = blockerType ? activateNpc(makeNpc(blockerType, targetCoord)) : null;
    const executeScript = npc.executeScript.bind(npc);
    npc.executeScript = state => {
        trace.entries.push({ name: state.script.name, tick: World.currentTick });
        return executeScript(state);
    };
    const repeatDraws = blockerType ? 50 : 1;
    let draws = 0;
    const desired = candidateFraction(candidateEntry.key, enumValues.length);
    try {
        withRandom(() => draws++ < repeatDraws ? desired : timerRandom, () => {
            for (let offset = 0; offset <= 3; offset++) {
                World.currentTick = startTick + offset;
                withWatch({ npc, trace }, () => npc.turn());
                trace.frames.push({
                    tick: World.currentTick,
                    coord: `${npc.level}_${npc.x}_${npc.z}`,
                    delayed: npc.delayed,
                    timerInterval: npc.timerInterval,
                    timerClock: npc.timerClock
                });
            }
        });
        return {
            npc, blocker, trace, draws, repeatDraws, desired,
            candidate: `${targetCoord.level}_${targetCoord.x}_${targetCoord.z}`,
            home: `${homeCoord.level}_${homeCoord.x}_${homeCoord.z}`,
            final: `${npc.level}_${npc.x}_${npc.z}`,
            timerInterval: npc.timerInterval,
            timerClock: npc.timerClock
        };
    } finally {
        disposeNpc(blocker);
        disposeNpc(npc);
    }
}

runCase('ai-timer-movement-period-boundaries', ctx => {
    const results = [];
    for (const { name, type } of eelTypes) {
        if (!type) throw new Error(`missing ${name}`);
        const enumValues = enumCoords(type);
        if (!enumValues.length) throw new Error(`missing movement enum for ${name}`);
        const targetIndex = enumValues.find(({ coord }) => !Array.from(World.npcs).some(npc => npc?.isActive && npc.level === coord.level && npc.x === coord.x && npc.z === coord.z && NpcType.get(npc.type)?.category === ids.slimeyfish))?.key;
        const low = runMovement(type, targetIndex, null, 0, 1000 + caseNumber * 20);
        const high = runMovement(type, targetIndex, null, 0.999999, 1100 + caseNumber * 20);
        if (!low || !high) throw new Error(`could not allocate map-backed movement fixtures for ${name}`);
        ctx.check(`${name} enters the packed AI_TIMER`, low.trace.entries[0]?.name ?? null, '[ai_timer,_slimeyfish]');
        ctx.check(`${name} suspends with npc_delay(2)`, low.trace.opcodes.NPC_DELAY, 1);
        ctx.check(`${name} calls npc_tele`, low.trace.opcodes.NPC_TELE, 1);
        ctx.check(`${name} sets timer`, low.trace.opcodes.NPC_SETTIMER, 1);
        ctx.check(`${name} lower period`, low.timerInterval, 280);
        ctx.check(`${name} upper period`, high.timerInterval, 529);
        ctx.check(`${name} picks enum tile`, low.final, low.candidate);
        ctx.check(`${name} stays home during delay`, low.trace.frames.slice(0, 3).map(frame => frame.coord), [low.home, low.home, low.home]);
        ctx.check(`${name} teleports on resumed tick +3`, low.trace.frames[3]?.coord, low.candidate);
        results.push({
            name,
            low: { candidate: low.candidate, home: low.home, final: low.final, timerInterval: low.timerInterval, draws: low.draws, trace: low.trace },
            high: { candidate: high.candidate, home: high.home, final: high.final, timerInterval: high.timerInterval, draws: high.draws, trace: high.trace }
        });
    }
    ctx.detail(results);
});

runCase('ai-timer-preserves-slimeyfish-occupancy-rule', ctx => {
    const results = [];
    for (const { name, type } of eelTypes) {
        if (!type) throw new Error(`missing ${name}`);
        const enumValues = enumCoords(type);
        const targetIndex = enumValues.find(({ coord }) => !Array.from(World.npcs).some(npc => npc?.isActive && npc.level === coord.level && npc.x === coord.x && npc.z === coord.z && NpcType.get(npc.type)?.category === ids.slimeyfish))?.key;
        const blockers = eelTypes.map(spec => spec.type).filter(Boolean);
        for (const blockerType of blockers) {
            const result = runMovement(type, targetIndex, blockerType, 0.25, 1300 + caseNumber * 20 + results.length * 10);
            if (!result) throw new Error(`could not allocate occupied movement fixture for ${name}`);
            ctx.check(`${name} rejects occupied ${blockerType.debugname} candidate after 50 draws`, result.final, result.home);
            ctx.check(`${name} still schedules timer after occupied candidates`, result.timerInterval >= 280 && result.timerInterval <= 529, true);
            ctx.check(`${name} runs movement delay and timer opcodes`, [result.trace.opcodes.NPC_DELAY, result.trace.opcodes.NPC_TELE, result.trace.opcodes.NPC_SETTIMER], [1, 1, 1]);
            results.push({ mover: name, blocker: blockerType.debugname, draws: result.draws, home: result.home, final: result.final, timer: result.timerInterval });
        }
    }
    ctx.detail(results);
});

runCase('walk-input-interrupts-fishing', ctx => {
    const observed = [];
    for (const { name, type } of eelTypes) {
        assert(type, `missing ${name}`);
        const { coord, approach } = reachableFishingFixture(type);
        const destination = neighbors(approach).find(tile => walkableLand(tile) && (tile.x !== approach.x || tile.z !== approach.z));
        assert(destination, `no walk destination beside ${name}`);
        const npc = activateNpc(makeNpc(type, coord));
        const { player, trace } = makePlayer(28);
        player.level = approach.level;
        player.x = approach.x;
        player.z = approach.z;
        equip(player, { rod: true, bait: 3, freeSlots: 2 });
        placePlayerForTarget(player, npc, ServerTriggerType.OPNPC1);
        const startTick = 1800 + caseNumber * 20;
        try {
            const start = interactTick(player, trace, startTick);
            const cast = interactTick(player, trace, startTick + 1);
            ctx.check(`${name} starts operation 1`, start.trigger, '[opnpc1,_slimeyfish]');
            ctx.check(`${name} casts before the walk`, cast.messages, ['You cast out your line...']);
            ctx.check(`${name} cast animation precedes the walk`, cast.animations, ['human_fishing_casting']);
            const handler = new MoveClickHandler();
            const accepted = handler.handle(new MoveClick([{ x: destination.x, z: destination.z }], 0, false), player);
            ctx.check(`${name} real MoveClick accepted`, accepted, true);
            ctx.check(`${name} walk clears fishing target`, player.target, null);
            ctx.check(`${name} walk queues a real route`, player.hasWaypoints(), true);
            const afterWalk = [];
            withRandom(() => 0, () => {
                for (let offset = 2; offset <= 13; offset++) {
                    afterWalk.push(interactTick(player, trace, startTick + offset));
                }
            });
            ctx.check(`${name} walks off the casting tile`, player.x !== approach.x || player.z !== approach.z, true);
            ctx.check(`${name} walk interruption does not reach fish_roll`, trace.fishRollCalls, 0);
            ctx.check(`${name} walk interruption adds no eel`, itemCount(player, ids.fish), 0);
            ctx.check(`${name} walk interruption consumes no bait`, itemCount(player, ids.bait), 3);
            ctx.check(`${name} walk interruption grants no XP`, player.stats[ids.fishingStat] - getExpByLevel(28), 0);
            observed.push({ name, approach, destination, start, cast, afterWalk, final: { x: player.x, z: player.z } });
        } finally {
            disposeNpc(npc);
        }
    }
    ctx.detail(observed);
});

console.log('LIMIT movement occupancy follows donor slimeyfish-category checks; enum map checks verify water and reachable walkable banks, not blocked-terrain filtering.');
for (const restore of handlerRestores.reverse()) restore();
console.log(`RESULT ${failed ? 'FAIL' : 'PASS'} slimy-eel: ${caseNumber - failed}/${caseNumber} cases passed`);
process.exit(failed ? 1 : 0);
