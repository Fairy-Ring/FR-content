/** Packed assignment gates and their existing access routes. No server or live client. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT, '../engine');
const PACK = path.join(ENGINE, 'data/pack');
process.chdir(ENGINE);
const eng = relative => import(pathToFileURL(path.join(ENGINE, relative)).href);
const { default: World } = await eng('src/engine/World.ts');
const { default: Player } = await eng('src/engine/entity/Player.ts');
const { default: Npc } = await eng('src/engine/entity/Npc.ts');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await eng('src/engine/entity/PlayerStat.ts');
const { default: ScriptProvider } = await eng('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('src/engine/script/ScriptState.ts');
const { default: ServerTriggerType } = await eng('src/engine/script/ServerTriggerType.ts');
const { default: JavaRandom } = await eng('src/util/JavaRandom.ts');
const { default: Environment } = await eng('src/util/Environment.ts');
const config = {};
for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType',
    'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component',
    'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType',
    'MesanimType', 'IdkType', 'HuntType'
]) {
    config[name] = (await eng(`src/cache/config/${name}.ts`)).default;
    config[name].load(PACK);
}
(await eng('src/cache/config/DbTableIndex.ts')).default.init();
Environment.NODE_MEMBERS = true;
Environment.NODE_DEBUG = false;
Environment.NODE_XPRATE = 1;
World.currentTick = 100;
assert(ScriptProvider.load(PACK) > 0, 'production script pack loads');
World.gameMap.init();

const ids = new Map();
function id(kind, name) {
    if (!ids.has(kind)) {
        ids.set(kind, new Map(fs.readFileSync(path.join(CONTENT, `pack/${kind}.pack`), 'utf8')
            .trim().split(/\r?\n/).map(line => {
                const at = line.indexOf('=');
                return [line.slice(at + 1).trim(), Number(line.slice(0, at))];
            })));
    }
    const value = ids.get(kind).get(name);
    assert(Number.isInteger(value), `${kind}.pack contains ${name}`);
    return value;
}
const TARGET = id('varp', 'slayer_target');
const COUNT = id('varp', 'slayer_count');
const TABLES = JSON.parse(fs.readFileSync(path.join(CONTENT, 'tests/slayer-selector/master_tables.json'), 'utf8'));
// CANDIDATE stage thresholds. Numeric task weights/ranges retain the UNKNOWN Lost City values.
const GATES = [
    { name: 'dustdevil', suffix: 'dustdevils', proc: 'slayer_deserttreasure_unlocked', variable: 'deserttreasuremain', threshold: 1, complete: 15, slayer: 65, combat: 70 },
    { name: 'dagannoth', suffix: 'dagannoths', proc: 'slayer_horror_unlocked', variable: 'deephorror', threshold: 10, complete: 10, slayer: 1, combat: 75 },
    { name: 'elf', suffix: 'elves', proc: 'slayer_regicide_unlocked', variable: 'regicide_quest', threshold: 2, complete: 15, slayer: 1, combat: 70 }
];
const MASTERS = [
    { name: 'vannaka', npc: 'slayer_master_3', combat: 40 },
    { name: 'chaeldar', npc: 'slayer_master_4', combat: 70 },
    { name: 'duradel', npc: 'slayer_master_5', combat: 100 }
];
function values(row, column) {
    const table = config.DbTableType.get(row.tableId);
    const at = table.columnNames.indexOf(column);
    assert(at >= 0, `packed table has ${column}`);
    const count = row.columnValues[at].length / row.types[at].length;
    return Array.from({ length: count }, (_, index) => {
        const value = row.getValue(at, index);
        return Array.isArray(value) ? value[0] : value;
    });
}
function rows(master) {
    const table = config.DbRowType.get(config.DbRowType.getId(`${master}_task_table`));
    assert(table, `${master} has a production task list`);
    return values(table, 'task').map(ref => {
        const row = config.DbRowType.get(ref);
        return Object.fromEntries(['task', 'weight', 'min_amount', 'max_amount'].map(column => [column, Number(values(row, column)[0])]));
    });
}
for (const gate of GATES) {
    const row = config.DbRowType.get(config.DbRowType.getId(`vannaka_${gate.suffix}`));
    gate.target = Number(values(row, 'task')[0]);
    gate.varId = id('varp', gate.variable);
    for (const master of MASTERS) {
        const expected = TABLES[master.name].filter(([, category]) => category === gate.name);
        assert.equal(expected.length, 1, `${master.name} has one ${gate.name} oracle row`);
        const actual = rows(master.name).filter(row => row.task === gate.target);
        assert.deepEqual(actual, [{ task: gate.target, weight: expected[0][2], min_amount: expected[0][3], max_amount: expected[0][4] }], `${master.name}/${gate.name}: exact packed membership, weight and amount`);
    }
    for (const master of ['turael', 'mazchna']) {
        assert(!rows(master).some(row => row.task === gate.target), `${master} cannot assign ${gate.name}`);
    }
}

function player() {
    const p = new Player('slayer_gates_fixture', 0n, 0n);
    p.uid = 1;
    p.pid = 1;
    p.lastMovement = 0;
    p.write = () => {};
    p.messageGame = () => {};
    p.wrappedMessageGame = () => {};
    p.baseLevels.fill(99);
    p.levels.fill(99);
    // Only prerequisite account state is seeded. Assignment writes remain production writes.
    for (const [name, stage] of Object.entries({ priestperil: 61, zanaris: 6, haunted: 3, legendsquest: 75, mourning_quest_part2: 5, rimmington_extras_var: 3 })) {
        p.setVar(id('varp', name), stage);
    }
    for (const gate of GATES) p.setVar(gate.varId, gate.threshold);
    return p;
}
function npc(master) {
    const type = id('npc', master.npc);
    return new Npc(0, 3551, 3550, 1, 1, EntityLifeCycle.DESPAWN, 1, type, config.NpcType.get(type).blockwalk);
}
function script(name) {
    const value = ScriptProvider.getByName(name);
    assert(value, `production ${name} is packed`);
    return value;
}
function finish(p, state) {
    for (let boundary = 0; state.execution !== ScriptState.FINISHED; boundary++) {
        assert(boundary < 30, `${state.script.name}: finite route/dialogue`);
        if (state.execution === ScriptState.SUSPENDED) {
            assert(p.delayed, 'production delay suspends the player');
            World.currentTick = Math.max(World.currentTick, p.delayedUntil);
            p.delayed = false;
        } else {
            assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'only ordinary dialogue may suspend this route');
        }
        p.executeScript(state, true, true);
    }
    return state;
}
function run(p, name, target = null, args = []) {
    const state = ScriptRunner.init(script(name), p, target, args);
    p.executeScript(state, true, true);
    return finish(p, state);
}
function runInt(p, name, target = null, args = []) {
    const state = run(p, name, target, args);
    assert(state.isp > 0, `${name} returns an integer`);
    return state.popInt();
}
function accepts(p, target) {
    return runInt(p, '[proc,validate_slayer_target]', null, [target]) === 1;
}
function randomStream(stream, action) {
    const original = JavaRandom.nextDouble;
    let index = 0;
    JavaRandom.nextDouble = () => {
        assert(index < stream.length, 'no unexpected random draws');
        return stream[index++];
    };
    try {
        const result = action();
        assert.equal(index, stream.length, 'the production selector consumes the planned draws');
        return result;
    } finally {
        JavaRandom.nextDouble = original;
    }
}
function combat(p, wanted) {
    const stats = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS, PlayerStat.RANGED, PlayerStat.MAGIC];
    for (let level = 1; level <= 99; level++) {
        for (let prayer = 1; prayer <= 99; prayer++) {
            const expected = Math.floor((2 * level + Math.floor(prayer / 2)) / 4 + 0.65 * level);
            if (expected !== wanted) continue;
            for (const stat of stats) {
                p.baseLevels[stat] = level;
                p.levels[stat] = 1;
            }
            p.baseLevels[PlayerStat.PRAYER] = prayer;
            p.levels[PlayerStat.PRAYER] = 1;
            assert.equal(runInt(p, '[proc,player_combat_level]'), wanted, 'fixture uses the exact base-stat combat boundary');
            return;
        }
    }
    assert.fail(`no valid combat fixture for ${wanted}`);
}
let assignments = 0;
function draw(p, master, roll, total, amountRoll) {
    assert(roll >= 0 && roll < total);
    const assigned = randomStream([(roll + 0.5) / total, amountRoll], () => runInt(p, '[proc,slayer_new_target]', npc(master)));
    assert.equal(assigned, 1, 'real master dispatch assigns a task');
    assignments++;
    return { target: p.getVar(TARGET), count: p.getVar(COUNT) };
}
function eligibleRows(p, master) {
    return rows(master.name).filter(row => accepts(p, row.task));
}
const stageResults = [];
for (const gate of GATES) {
    for (let stage = 0; stage <= gate.complete; stage++) {
        const p = player();
        // Desert Treasure is a low-15-bit varbit. Other subquest flags must not unlock it.
        for (const unrelatedBits of gate.name === 'dustdevil' ? [0, 1 << 15, 1 << 29] : [0]) {
            p.setVar(gate.varId, stage | unrelatedBits);
            const before = p.vars.slice();
            randomStream([], () => {
                assert.equal(runInt(p, `[proc,${gate.proc}]`), Number(stage >= gate.threshold), `${gate.name}: direct predicate at stage ${stage}, other bits ${unrelatedBits}`);
                assert.equal(accepts(p, gate.target), stage >= gate.threshold, `${gate.name}: validator at stage ${stage}`);
            });
            assert.deepEqual(p.vars, before, 'predicates and validator write no player state');
        }
        p.setVar(gate.varId, stage);
        for (const master of MASTERS) {
            const eligible = eligibleRows(p, master);
            const total = eligible.reduce((sum, row) => sum + row.weight, 0);
            const offset = eligible.slice(0, eligible.findIndex(row => row.task === gate.target)).reduce((sum, row) => sum + row.weight, 0);
            if (stage < gate.threshold) {
                assert(!eligible.some(row => row.task === gate.target), 'locked task contributes no weight');
                // Every integer roll at the last locked stage proves actual exclusion, not just a helper result.
                if (stage === gate.threshold - 1) {
                    for (let roll = 0; roll < total; roll++) assert.notEqual(draw(p, master, roll, total, 0).target, gate.target);
                }
            } else {
                assert.equal(runInt(p, '[proc,slayer_master_eligible]', npc(master), [id('npc', master.npc)]), 1, 'fixture is admitted by this master');
                const row = eligible.find(row => row.task === gate.target);
                for (let roll = offset; roll < offset + row.weight; roll++) {
                    assert.deepEqual(draw(p, master, roll, total, 0), { target: gate.target, count: row.min_amount }, `${gate.name} stage ${stage}/${master.name}: each of its exact weighted slots assigns the inclusive minimum`);
                }
                assert.deepEqual(draw(p, master, offset + row.weight - 1, total, 1 - Number.EPSILON), { target: gate.target, count: row.max_amount }, 'inclusive maximum amount');
                for (const roll of [offset - 1, offset + row.weight].filter(roll => roll >= 0 && roll < total)) {
                    assert.notEqual(draw(p, master, roll, total, 0).target, gate.target, 'adjacent weighted slots belong to other tasks');
                }
            }
        }
        stageResults.push({ task: gate.name, stage, accepted: stage >= gate.threshold });
    }
    for (const cb of [gate.combat - 1, gate.combat, gate.combat + 1]) {
        const p = player();
        combat(p, cb);
        p.baseLevels[PlayerStat.SLAYER] = gate.slayer;
        p.levels[PlayerStat.SLAYER] = 99;
        assert.equal(accepts(p, gate.target), cb >= gate.combat, `${gate.name}: combat boundary ${cb}`);
    }
    for (const [base, current, expected] of gate.slayer > 1 ? [[64, 99, false], [65, 1, true], [66, 1, true]] : [[1, 99, true], [2, 1, true]]) {
        const p = player();
        p.baseLevels[PlayerStat.SLAYER] = base;
        p.levels[PlayerStat.SLAYER] = current;
        assert.equal(accepts(p, gate.target), expected, `${gate.name}: base Slayer ${base}, current ${current}`);
    }
    for (const master of MASTERS) {
        const p = player();
        combat(p, Math.max(master.combat, gate.combat));
        p.baseLevels[PlayerStat.SLAYER] = gate.slayer;
        p.levels[PlayerStat.SLAYER] = master.name === 'duradel' ? 50 : 1;
        assert.equal(runInt(p, '[proc,slayer_master_eligible]', npc(master), [id('npc', master.npc)]), 1, 'minimum task fixture meets master admission including Duradel current Slayer50');
        const eligible = eligibleRows(p, master);
        const index = eligible.findIndex(row => row.task === gate.target);
        assert(index >= 0);
        const offset = eligible.slice(0, index).reduce((sum, row) => sum + row.weight, 0);
        const total = eligible.reduce((sum, row) => sum + row.weight, 0);
        assert.equal(draw(p, master, offset, total, 0).target, gate.target, 'real assignment at combined task/master minimums');
    }
}

function tile(p) { return [p.level, p.x, p.z]; }
function operate(p, name, location) {
    const trigger = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPLOC1, id('loc', name));
    assert(trigger, `${name} has its real OPLOC1 dispatch`);
    assert.equal(trigger.name, `[oploc1,${name}]`);
    const state = ScriptRunner.init(trigger, p, location);
    p.executeScript(state, true, true);
    finish(p, state);
}
const routeResults = [];
for (const stage of [2, 4, 5, 9, 10]) {
    const p = player();
    p.setVar(id('varp', 'deephorror'), stage);
    p.level = 0; p.x = 2518; p.z = 4618;
    const start = tile(p);
    operate(p, 'horror_ladder_top');
    const expected = stage === 10 ? [1, 2518, 9994] : stage > 2 ? [1, 2518, 4618] : start;
    assert.deepEqual(tile(p), expected, 'Horror completion selects the normal dungeon; earlier repaired stages select only the quest cave');
    assert.equal(accepts(p, GATES[1].target), stage === 10, 'quest-cave access alone does not unlock dagannoth assignments');
    assert.equal(p.getVar(id('varp', 'deephorror')), stage, 'ladder does not advance quest state');
    routeResults.push({ route: 'horror ladder', stage, destination: tile(p) });
}
for (const stage of [0, 1, 2, 15]) {
    const p = player();
    p.setVar(id('varp', 'regicide_quest'), stage);
    p.setVar(id('varp', 'upass'), 10);
    p.level = 1; p.x = 2144; p.z = 4648;
    const start = tile(p);
    const door = World.getLoc(2143, 4648, 1, id('loc', 'upass_templedoor_closed_right'));
    assert(door, 'native temple door is present in the packed map');
    operate(p, 'upass_templedoor_closed_right', door);
    assert.deepEqual(tile(p), stage >= 2 ? [1, 2014, 4712] : start, 'Regicide assignment and published temple route share the Lathas threshold');
    assert.equal(accepts(p, GATES[2].target), stage >= 2);
    assert.equal(p.getVar(id('varp', 'regicide_quest')), stage, 'door does not advance Regicide');
    routeResults.push({ route: 'Underground Pass temple door', stage, destination: tile(p) });
    // Restore only this fixture's temporary loc change before the next independent player.
    for (const loc of World.gameMap.getZone(2143, 4648, 1).getAllLocsUnsafe()) {
        while (loc.lifecycleTick > 0) loc.turn();
    }
}
for (const stage of [0, 1, 10, 15]) {
    const p = player();
    p.setVar(id('varp', 'deserttreasuremain'), stage);
    p.level = 0; p.x = 3311; p.z = 2962;
    operate(p, 'sword_haunted_well');
    assert.deepEqual(tile(p), [0, 3206, 9379], 'S2 Smoke well is already open even before Desert Treasure starts');
    assert.equal(accepts(p, GATES[0].target), stage >= 1, 'assignment uses the approved started threshold despite the documented open-well discrepancy');
    assert.equal(p.getVar(id('varp', 'deserttreasuremain')), stage, 'well does not advance Desert Treasure');
    routeResults.push({ route: 'Smoke well (existing access discrepancy)', stage, destination: tile(p) });
}
console.log(JSON.stringify({ status: 'PASS', assignments, stageResults, routeResults }, null, 2));
// World imports background workers. This is a standalone offline runner.
process.exit(0);
