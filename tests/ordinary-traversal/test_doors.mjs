import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { approach, CollisionType, content, locFor, map, types, World } from '../stair-links/runtime.mjs';

const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const loadDefault = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const Player = await loadDefault('engine/entity/Player.ts');
const ServerTriggerType = await loadDefault('engine/script/ServerTriggerType.ts');
const { Interaction } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/Interaction.ts')).href);

const doubleFamilies = [
    {
        leftClosed: 'slayertower_door',
        leftOpened: 'slayertower_door_open',
        rightClosed: 'slayertower_door_mirror',
        rightOpened: 'slayertower_door_open_mirror'
    },
    {
        leftClosed: 'wild_doubledoor_l',
        leftOpened: 'wild_doubledoor_open_l',
        rightClosed: 'wild_doubledoor_r',
        rightOpened: 'wild_doubledoor_open_r'
    },
    {
        leftClosed: 'door_10527',
        leftOpened: 'door_10528',
        rightClosed: 'door_10529',
        rightOpened: 'door_10530'
    },
    {
        leftClosed: 'castle_door_11717',
        leftOpened: 'castle_door_11718',
        rightClosed: 'castle_door_11719',
        rightOpened: 'castle_door_11720'
    },
    {
        leftClosed: 'fai_barbarian_large_doubledoor_l',
        leftOpened: 'fai_barbarian_open_large_doubledoor_l',
        rightClosed: 'fai_barbarian_large_doubledoor_r',
        rightOpened: 'fai_barbarian_open_large_doubledoor_r'
    }
];
const bindings = new Map();
for (const pair of doubleFamilies) {
    bindings.set(pair.leftClosed, { category: 'door_left_closed', next: pair.leftOpened, phase: 'closed', side: 'left', pair });
    bindings.set(pair.rightClosed, { category: 'door_right_closed', next: pair.rightOpened, phase: 'closed', side: 'right', pair });
    bindings.set(pair.leftOpened, { category: 'door_left_opened', next: pair.leftClosed, phase: 'opened', side: 'left', pair });
    bindings.set(pair.rightOpened, { category: 'door_right_opened', next: pair.rightClosed, phase: 'opened', side: 'right', pair });
}
bindings.set('wild_door', { category: 'door_closed', next: 'wild_door_open', phase: 'closed', side: null });
bindings.set('wild_door_open', { category: 'door_opened', next: 'wild_door', phase: 'opened', side: null });
bindings.set('door_5126', { category: 'door_closed', next: 'door_5128', phase: 'closed', side: null });
bindings.set('door_5128', { category: 'door_opened', next: 'door_5126', phase: 'opened', side: null });

const requiredNativeNames = [
    'wild_door', 'wild_doubledoor_l', 'wild_doubledoor_r',
    'slayertower_door', 'slayertower_door_mirror', 'door_5126', 'door_10527', 'door_10529',
    'castle_door_11717', 'castle_door_11719',
    'fai_barbarian_open_large_doubledoor_r', 'fai_barbarian_open_large_doubledoor_l'
];
const unplacedClosedBarbarianNames = [
    'fai_barbarian_large_doubledoor_l', 'fai_barbarian_large_doubledoor_r'
];
const locNameById = new Map(readFileSync(path.join(content, 'pack/loc.pack'), 'utf8').trim().split(/\r?\n/).map(line => {
    const separator = line.indexOf('=');
    return [Number(line.slice(0, separator)), line.slice(separator + 1).trim()];
}));
const nextStageParam = types.ParamType.getId('next_loc_stage');
assert.notEqual(nextStageParam, -1, 'the published next_loc_stage param is loaded');

for (const [name, binding] of bindings) {
    const id = types.LocType.getId(name);
    assert.notEqual(id, -1, `${name}: cache loc type exists`);
    const type = types.LocType.get(id);
    assert.equal(types.CategoryType.get(type.category)?.toString(), binding.category, `${name}: correct generic family category`);
    assert.equal(locNameById.get(type.params.get(nextStageParam)), binding.next, `${name}: next_loc_stage resolves to its exact cache partner`);
    assert.equal(type.op?.[0], binding.phase === 'closed' ? 'Open' : 'Close', `${name}: original cache option is preserved`);
}

const native = [];
const floors = new Set();
for (const file of readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort()) {
    const [, mapX, mapZ] = /^m(\d+)_(\d+)\.jm2$/.exec(file).map(Number);
    let section = '';
    for (const line of readFileSync(path.join(content, 'maps', file), 'utf8').split('\n')) {
        if (line.startsWith('====')) {
            section = line.split(' ')[1];
            continue;
        }
        const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
        if (!match) continue;
        const level = Number(match[1]);
        const x = (mapX << 6) + Number(match[2]);
        const z = (mapZ << 6) + Number(match[3]);
        if (section === 'MAP' && /(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(match[4])) {
            floors.add(`${level},${x},${z}`);
        }
        if (section !== 'LOC') continue;
        const [id, shape = 10, angle = 0] = match[4].split(' ').map(Number);
        const name = locNameById.get(id);
        if (bindings.has(name)) native.push({ name, level, x, z, shape, angle });
    }
}
for (const name of requiredNativeNames) {
    assert.ok(native.some(row => row.name === name), `${name}: every requested native location type is placed in the 377 maps`);
}
for (const name of unplacedClosedBarbarianNames) {
    assert.equal(native.some(row => row.name === name), false, `${name}: closed cache counterpart remains unplaced natively`);
}

const mod4 = angle => (angle + 4) % 4;
const openDelta = (shape, angle) => {
    const table = shape === 0
        ? [[-1, 0], [0, 1], [1, 0], [0, -1]]
        : shape === 9
            ? [[0, 1], [1, 0], [0, -1], [-1, 0]]
            : null;
    assert.ok(table, `door geometry supports only generic straight/diagonal wall shapes, received ${shape}`);
    return table[angle];
};
const closeDelta = (shape, angle) => {
    const table = shape === 0
        ? [[0, 1], [1, 0], [0, -1], [-1, 0]]
        : shape === 9
            ? [[1, 0], [0, -1], [-1, 0], [0, 1]]
            : null;
    assert.ok(table, `door geometry supports only generic straight/diagonal wall shapes, received ${shape}`);
    return table[angle];
};
const addDelta = (row, [dx, dz]) => ({ ...row, x: row.x + dx, z: row.z + dz });
const negate = ([dx, dz]) => [-dx, -dz];

function openStage(row, binding) {
    const delta = openDelta(row.shape, row.angle);
    const angleDelta = binding.side === 'left' ? 3 : 1;
    return { ...addDelta(row, delta), name: binding.next, angle: mod4(row.angle + angleDelta) };
}

function closedStage(row, binding) {
    const delta = closeDelta(row.shape, row.angle);
    const signedDelta = binding.side === 'left' ? negate(delta) : delta;
    const angleDelta = binding.side === 'left' ? 1 : 3;
    return { ...addDelta(row, signedDelta), name: binding.next, angle: mod4(row.angle + angleDelta) };
}

function pairMate(row, binding) {
    const { pair, side, phase } = binding;
    const name = phase === 'closed'
        ? (side === 'left' ? pair.rightClosed : pair.leftClosed)
        : (side === 'left' ? pair.rightOpened : pair.leftOpened);
    let delta;
    if (phase === 'closed') {
        const close = closeDelta(row.shape, row.angle);
        delta = side === 'left' ? close : negate(close);
    } else {
        delta = negate(openDelta(row.shape, row.angle));
    }
    const [dx, dz] = delta;
    const matches = native.filter(candidate => candidate.name === name && candidate.level === row.level && candidate.x === row.x + dx && candidate.z === row.z + dz);
    assert.equal(matches.length, 1, `${row.name}@${row.level},${row.x},${row.z}: exactly one angle-derived ${name} double-door mate`);
    const mate = matches[0];
    assert.equal(mate.shape, row.shape, `${row.name}: paired leaf retains the wall shape`);
    assert.equal(mate.angle, phase === 'closed' ? row.angle : mod4(row.angle + 2), `${row.name}: paired leaf rotation agrees with the generic family`);
    return mate;
}

function assertPresent(row, label) {
    const id = types.LocType.getId(row.name);
    const loc = World.getLoc(row.x, row.z, row.level, id);
    assert.ok(loc, `${label}: ${row.name} remains at ${row.level},${row.x},${row.z}`);
    assert.deepEqual([loc.type, loc.level, loc.x, loc.z, loc.shape, loc.angle], [id, row.level, row.x, row.z, row.shape, row.angle], `${label}: exact type, coordinate, shape, and rotation`);
    return loc;
}

function assertAbsent(row, label) {
    const id = types.LocType.getId(row.name);
    assert.equal(World.getLoc(row.x, row.z, row.level, id), null, `${label}: no stale ${row.name} remains at ${row.level},${row.x},${row.z}`);
}

let playerSerial = 0;
function dispatch(row) {
    const binding = bindings.get(row.name);
    assert.ok(binding, `${row.name}: expected binding is inventoried`);
    const loc = World.getLoc(row.x, row.z, row.level, types.LocType.getId(row.name));
    assert.ok(loc, `${row.name}: engine map contains current target stage`);
    assert.equal(loc.angle, row.angle, `${row.name}: interaction uses current location rotation`);
    const player = new Player(`ordinary_door_${++playerSerial}`, BigInt(playerSerial), BigInt(playerSerial));
    player.slot = playerSerial;
    player.pid = playerSerial;
    player.uid = BigInt(playerSerial);
    player.vars.fill(0);
    const messages = [];
    player.messageGame = message => messages.push(message);
    [player.level, player.x, player.z] = approach(row);
    assert.ok(player.setInteraction(Interaction.ENGINE, loc, ServerTriggerType.APLOC1), `${row.name}: player accepts the location interaction`);
    const script = player.getOpTrigger();
    assert.ok(script, `${row.name}: Player trigger lookup resolves the action`);
    assert.equal(script.name, `[oploc1,_${binding.category}]`, `${row.name}: Player dispatch selects the expected generic family`);
    assert.equal(player.tryInteract(true), true, `${row.name}: Player executes the selected scenery operation`);
    assert.equal(messages.some(message => /No trigger for|Nothing interesting happens/i.test(message)), false, `${row.name}: operation is not the engine fallback`);
}

function passageEdges(bases, angle) {
    let [dx, dz] = openDelta(bases[0].shape, angle);
    // Shape 9 clips a ground square, not a straight-wall edge. Its leaf moves
    // along openDelta; test crossing the vacated square perpendicular to it.
    if (bases[0].shape === 9) [dx, dz] = [-dz, dx];
    const tangent = [-dz, dx];
    const edges = new Map();
    for (const base of bases) {
        for (let along = -2; along <= 1; along++) {
            for (let across = -2; across <= 2; across++) {
                const x = base.x + along * dx + across * tangent[0];
                const z = base.z + along * dz + across * tangent[1];
                const toX = x + dx;
                const toZ = z + dz;
                const fromKey = `${base.level},${x},${z}`;
                const toKey = `${base.level},${toX},${toZ}`;
                if (!floors.has(fromKey) || !floors.has(toKey)) continue;
                const key = `${base.level},${x},${z},${dx},${dz}`;
                edges.set(key, { level: base.level, x, z, dx, dz });
            }
        }
    }
    return [...edges.values()];
}

function canStep(edge, reverse = false) {
    const sign = reverse ? -1 : 1;
    return map.canTravel(edge.level, edge.x + (reverse ? edge.dx : 0), edge.z + (reverse ? edge.dz : 0), sign * edge.dx, sign * edge.dz, 1, 0, CollisionType.NORMAL);
}
const blockedBothWays = edge => !canStep(edge) && !canStep(edge, true);
const passableBothWays = edge => canStep(edge) && canStep(edge, true);

function runSingle(row, binding) {
    const edges = passageEdges([row], row.angle);
    const blocked = edges.filter(blockedBothWays);
    assert.ok(blocked.length, `${row.name}: native closed doorway blocks map travel from both sides`);
    const opened = openStage(row, binding);
    dispatch(row);
    assertPresent(opened, `${row.name}: open stage`);
    assertAbsent(row, `${row.name}: old closed stage`);
    const passage = blocked.find(passableBothWays);
    assert.ok(passage, `${row.name}: opening creates a two-way passage in production collision`);
    dispatch(opened);
    assertPresent(row, `${row.name}: restored closed stage`);
    assertAbsent(opened, `${row.name}: stale open stage`);
    assert.ok(blockedBothWays(passage), `${row.name}: closing restores the blocked passage from both sides`);
}

function runDoubleClosed(row, binding) {
    const mate = pairMate(row, binding);
    locFor(row);
    locFor(mate);
    const originals = [row, mate];
    const edges = passageEdges(originals, row.angle);
    const blocked = edges.filter(blockedBothWays);
    assert.ok(blocked.length, `${row.name}: native double-door opening is blocked from both sides`);
    const openedPair = originals.map(source => openStage(source, bindings.get(source.name)));
    dispatch(row);
    for (const opened of openedPair) assertPresent(opened, `${row.name}: both intended open leaves`);
    for (const source of originals) assertAbsent(source, `${row.name}: closed leaf removed`);
    const passage = blocked.find(passableBothWays);
    assert.ok(passage, `${row.name}: opening creates a two-way passage in production collision`);
    const clickedOpen = openedPair.find(opened => opened.name === binding.next);
    dispatch(clickedOpen);
    const restored = openedPair.map(opened => closedStage(opened, bindings.get(opened.name)));
    for (const original of originals) assertPresent(original, `${row.name}: exact original pair restored`);
    for (const opened of openedPair) assertAbsent(opened, `${row.name}: no stale open leaf`);
    assert.deepEqual(restored.map(row => [row.name, row.level, row.x, row.z, row.shape, row.angle]).sort(), originals.map(row => [row.name, row.level, row.x, row.z, row.shape, row.angle]).sort(), `${row.name}: pair partner, coordinates, shape, and rotations round-trip`);
    assert.ok(blockedBothWays(passage), `${row.name}: closing restores blocked collision from both sides`);
}

function runDoubleOpened(row, binding) {
    const mate = pairMate(row, binding);
    locFor(row);
    locFor(mate);
    const originals = [row, mate];
    const closedPair = originals.map(opened => closedStage(opened, bindings.get(opened.name)));
    const edges = passageEdges(closedPair, closedPair[0].angle);
    const initiallyOpen = edges.filter(passableBothWays);
    assert.ok(initiallyOpen.length, `${row.name}: native placed-open doorway admits travel from both sides`);
    dispatch(row);
    for (const closed of closedPair) assertPresent(closed, `${row.name}: unplaced closed counterpart becomes placed`);
    for (const opened of originals) assertAbsent(opened, `${row.name}: open leaf removed while closing`);
    const passage = initiallyOpen.find(blockedBothWays);
    assert.ok(passage, `${row.name}: closing blocks the passage from both sides`);
    const closedClicked = closedPair.find(closed => closed.name === binding.next);
    assert.ok(closedClicked, `${row.name}: matching previously unplaced closed counterpart exists`);
    dispatch(closedClicked);
    const reopenedPair = closedPair.map(closed => openStage(closed, bindings.get(closed.name)));
    for (const original of originals) assertPresent(original, `${row.name}: exact original placed-open pair restored`);
    for (const closed of closedPair) assertAbsent(closed, `${row.name}: closed counterpart reopened`);
    assert.deepEqual(reopenedPair.map(row => [row.name, row.level, row.x, row.z, row.shape, row.angle]).sort(), originals.map(row => [row.name, row.level, row.x, row.z, row.shape, row.angle]).sort(), `${row.name}: open pair partner, coordinates, shape, and rotations round-trip`);
    assert.ok(passableBothWays(passage), `${row.name}: reopening restores two-way production collision`);
}

function runSingleOpened(row, binding) {
    const closed = closedStage(row, binding);
    const edges = passageEdges([closed], closed.angle);
    const initiallyOpen = edges.filter(passableBothWays);
    assert.ok(initiallyOpen.length, `${row.name}: native open door admits map travel from both sides`);
    dispatch(row);
    assertPresent(closed, `${row.name}: matching closed state`);
    const passage = initiallyOpen.find(blockedBothWays);
    assert.ok(passage, `${row.name}: closing blocks the passage from both sides`);
    dispatch(closed);
    assertPresent(row, `${row.name}: exact original open state restored`);
    assert.ok(passableBothWays(passage), `${row.name}: reopening restores two-way production collision`);
}

let scenarios = 0;
for (const row of native) {
    const binding = bindings.get(row.name);
    const runtimeLoc = locFor(row);
    assert.equal(runtimeLoc.shape, row.shape, `${row.name}: cache placement shape matches packed runtime`);
    if (binding.phase === 'closed') {
        if (binding.side) runDoubleClosed(row, binding);
        else runSingle(row, binding);
    } else if (binding.side) {
        runDoubleOpened(row, binding);
    } else {
        runSingleOpened(row, binding);
    }
    scenarios++;
}

assert.ok(scenarios >= requiredNativeNames.length, 'all requested native placements received an engine-dispatched round trip');
console.log(`PASS ordinary-traversal: ${scenarios} native placements; both unplaced barbarian closed counterparts reopened through Player dispatch`);
process.exit(0);
