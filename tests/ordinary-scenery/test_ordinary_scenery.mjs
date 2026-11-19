import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const load = async file => (await import(pathToFileURL(path.join(engine, 'src', file)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
const audit = await import('../loc-option-audit/audit.mts');
const client = audit.loadPack(path.join(engine, 'data/pack'));
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'Component', 'FontType']) {
    types[name] = await load(`cache/config/${name}.ts`);
    types[name].load(path.join(engine, 'data/pack'));
}
(await load('cache/config/DbTableIndex.ts')).init();
const crops = [{ name: 'wheat_tall', slot: 2, control: 'wheat' }];
const milkers = [{ name: 'fairy_fat_cow', slot: 2, control: 'fat_cow', controlSlot: 1 }];
const id = (kind, name) => {
    const value = types[kind].getId(name);
    assert.notEqual(value, -1, `${kind}: ${name}`);
    return value;
};
const inventory = id('InvType', 'inv');
const grain = id('ObjType', 'grain');
const placements = audit.readPlacements(path.join(engine, 'data/pack')).placements;
const options = audit.scan(placements, client).options;
for (const row of [...crops, ...milkers]) {
    const contexts = options.filter(option => option.form.type === id('LocType', row.name) && option.slot === row.slot);
    assert(contexts.length, `${row.name}:${row.slot}: original mapped option exists`);
    const control = options.find(option => option.form.type === id('LocType', row.control) && option.slot === (row.controlSlot ?? row.slot))?.op.script;
    assert(control, `${row.control}: published family entry exists`);
    for (const option of contexts) {
        assert.equal(option.kind, 'handled', `${row.name}:${row.slot}: native family dispatch`);
        const entry = option.op.script;
        assert(entry, `${row.name}: native operation entry exists`);
        if (crops.includes(row)) {
            for (const field of ['opcodes', 'intOperands', 'stringOperands', 'intLocalCount', 'stringLocalCount', 'intArgCount', 'stringArgCount', 'switchTables']) {
                assert.deepEqual(entry[field], control[field], `${row.name}: compiled entry joins the same published family`);
            }
        }
    }
}

World.currentTick = 100;
World.gameMap.init();
const handler = new OpLocHandler();
let serial = 0;
function approach(loc) {
    const type = types.LocType.get(loc.type);
    for (let radius = 0; radius <= 2; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = loc.x + dx, z = loc.z + dz;
                if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z, loc.x, loc.z, type.width, type.length, 1, loc.angle, loc.shape, type.forceapproach)) return [x, z];
            }
        }
    }
    assert.fail(`${type.debugname}: original map has a walkable approach`);
}
function player(loc, full) {
    const p = new Player(`locrest${++serial}`, BigInt(serial), BigInt(serial));
    p.pid = p.slot = serial;
    p.uid = BigInt(serial);
    p.vars.fill(0);
    p.baseLevels.fill(1); p.levels.fill(1); p.stats.fill(0);
    p.setVar(id('VarPlayerType', 'tutorial'), 1000);
    p.level = loc.level;
    [p.x, p.z] = approach(loc);
    p.originX = p.x; p.originZ = p.z;
    p.messages = [];
    p.messageGame = text => p.messages.push(String(text));
    p.wrappedMessageGame = text => p.messages.push(String(text));
    if (full) p.invAdd(inventory, id('ObjType', 'bronze_dagger'), types.InvType.get(inventory).size);
    return p;
}
function pick(loc, slot, full, arriving = false) {
    const p = player(loc, full);
    const start = World.currentTick;
    if (arriving) p.lastMovement = start;
    const stats = Array.from(p.stats);
    assert.equal(handler.handle(new OpLoc(slot, loc.x, loc.z, loc.type), p), true);
    assert.equal(p.target, loc);
    assert.equal(p.getApTrigger(), null);
    const script = p.getOpTrigger();
    assert(script, `${types.LocType.get(loc.type).debugname}: native Pick dispatch`);
    const state = ScriptRunner.init(script, p, loc);
    let execution = p.runScript(state, true, true);
    const delays = [];
    for (let boundary = 0; execution === ScriptState.SUSPENDED && boundary < 8; boundary++) {
        delays.push(p.delayedUntil - World.currentTick);
        World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
        p.delayed = false;
        execution = p.runScript(state, true, true);
    }
    assert.equal(execution, ScriptState.FINISHED, `${script.name}: native interpreter finishes`);
    assert.deepEqual(Array.from(p.stats), stats, 'ordinary grain picking grants no XP');
    const result = { messages: p.messages, grain: p.invTotal(inventory, grain), ticks: World.currentTick - start, delays, lifecycle: loc.lifecycleTick };
    if (!full) {
        assert.equal(result.grain, 1, 'player receives one grain');
        assert.deepEqual([p.x, p.z, p.level], [loc.x, loc.z, loc.level], 'inherited floor-pick approach');
        const deadline = loc.lifecycleTick;
        assert(deadline > 0, 'native deletion has a respawn deadline');
        assert.equal(loc.isActive, false, 'native pick deletes the original crop');
        assert.equal(World.getLoc(loc.x, loc.z, loc.level, loc.type), null, 'deleted crop is absent from the native world');
        for (let tick = 1; tick < deadline; tick++) { World.currentTick++; loc.turn(); }
        assert(loc.lifecycleTick > 0, 'crop stays deleted before the inherited deadline');
        assert.equal(loc.isActive, false, 'crop stays inactive before its native deadline');
        World.currentTick++; loc.turn();
        assert.equal(loc.lifecycleTick, -1, 'native crop lifecycle restores at the inherited deadline');
        assert.equal(World.getLoc(loc.x, loc.z, loc.level, loc.type), loc, 'original crop is restored');
    } else {
        assert.equal(result.grain, 0, 'full inventory receives no grain');
        assert.equal(loc.lifecycleTick, -1, 'full inventory leaves original crop intact');
    }
    return result;
}
function milk(loc, slot, buckets, full = false) {
    const p = player(loc, false);
    const empty = id('ObjType', 'bucket_empty'), product = id('ObjType', 'bucket_milk');
    if (full) p.invAdd(inventory, id('ObjType', 'bronze_dagger'), types.InvType.get(inventory).size - buckets);
    if (buckets > 0) p.invAdd(inventory, empty, buckets);
    const start = World.currentTick, stats = Array.from(p.stats), messages = [];
    p.messageGame = p.wrappedMessageGame = text => messages.push([World.currentTick - start, String(text)]);
    assert.equal(handler.handle(new OpLoc(slot, loc.x, loc.z, loc.type), p), true);
    assert.equal(p.target, loc);
    assert.equal(p.getApTrigger(), null);
    const script = p.getOpTrigger();
    assert(script, `${types.LocType.get(loc.type).debugname}: native Milk dispatch`);
    assert.equal(p.runScript(ScriptRunner.init(script, p, loc), true, true), ScriptState.FINISHED);
    const queued = p.weakQueue.head();
    assert.equal(queued !== null, buckets > 0, 'only an empty bucket schedules the published milk queue');
    const schedule = queued === null ? null : { script: queued.script, delay: queued.delay, args: queued.args };
    for (let tick = 0; p.weakQueue.head() !== null && tick < 64; tick++) {
        World.currentTick++;
        p.processQueues();
    }
    assert.equal(p.weakQueue.head(), null, 'native milking queue stops after the last empty bucket');
    assert.deepEqual(Array.from(p.stats), stats, 'ordinary milking grants no XP');
    assert.equal(p.invTotal(inventory, empty), 0, 'all empty buckets are consumed');
    assert.equal(p.invTotal(inventory, product), buckets, 'each empty bucket becomes one bucket of milk');
    assert.equal(loc.isActive, true, 'milking leaves the original dairy cow active');
    assert.equal(World.getLoc(loc.x, loc.z, loc.level, loc.type), loc, 'milking leaves the original dairy cow in the native world');
    return { messages, ticks: World.currentTick - start, empty: p.invTotal(inventory, empty), milk: p.invTotal(inventory, product), schedule };
}
let builtPlacements = 0;
for (const spec of crops) {
    const controlPlacement = placements.find(p => p.type === id('LocType', spec.control));
    assert(controlPlacement, 'published family member has an original placement');
    const control = World.getLoc(controlPlacement.x, controlPlacement.z, controlPlacement.level, controlPlacement.type);
    assert(control, 'published family member is loaded');
    const expected = pick(control, spec.slot, false);
    const fullExpected = pick(control, spec.slot, true);
    const arrivingExpected = pick(control, spec.slot, false, true);
    const arrivingFullExpected = pick(control, spec.slot, true, true);
    const rows = placements.filter(p => p.type === id('LocType', spec.name));
    assert(rows.length, `${spec.name}: original placements`);
    for (const row of rows) {
        const loc = World.getLoc(row.x, row.z, row.level, row.type);
        assert(loc, `${spec.name}: original mapped loc is loaded`);
        assert.deepEqual(pick(loc, spec.slot, false), expected, `${spec.name}: product, XP, message, timing and deletion match the published member`);
        assert.deepEqual(pick(loc, spec.slot, true), fullExpected, `${spec.name}: full-inventory behavior matches the published member`);
        assert.deepEqual(pick(loc, spec.slot, false, true), arrivingExpected, `${spec.name}: arrival-delay timing matches the published member`);
        assert.deepEqual(pick(loc, spec.slot, true, true), arrivingFullExpected, `${spec.name}: arriving with full inventory matches the published member`);
        builtPlacements++;
    }
}
for (const spec of milkers) {
    const controlPlacement = placements.find(p => p.type === id('LocType', spec.control) && p.x === 2585 && p.z === 3122);
    assert(controlPlacement, 'published dairy-cow control outside the milkmaid tutorial area');
    const control = World.getLoc(controlPlacement.x, controlPlacement.z, controlPlacement.level, controlPlacement.type);
    assert(control, 'published dairy-cow control is loaded');
    const cases = [{ buckets: 0 }, { buckets: 1 }, { buckets: 2 }, { buckets: 1, full: true }];
    const expected = cases.map(test => milk(control, spec.controlSlot, test.buckets, test.full));
    const rows = placements.filter(p => p.type === id('LocType', spec.name));
    assert(rows.length, `${spec.name}: original placements`);
    for (const row of rows) {
        const loc = World.getLoc(row.x, row.z, row.level, row.type);
        assert(loc, `${spec.name}: original mapped dairy cow is loaded`);
        cases.forEach((test, index) => {
            const actual = milk(loc, spec.slot, test.buckets, test.full);
            assert.equal(actual.schedule?.script, expected[index].schedule?.script, `${spec.name}: native queue is the published milk queue`);
            assert.deepEqual(actual, expected[index],
                `${spec.name}: bucket exchange, XP, messages and native queue timing match the published member`);
        });
        builtPlacements++;
    }
}
console.log(`ORDINARY_SCENERY_PASS built=${crops.length + milkers.length} placements=${builtPlacements} native-family-equivalence=true`);
process.exit(0);
