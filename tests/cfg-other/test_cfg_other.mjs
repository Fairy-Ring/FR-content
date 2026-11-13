#!/usr/bin/env node
// Inherited Lost City 289 server values, not claims of 377-period accuracy.
// Run from the sibling engine with node --import tsx.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(here, '../../../engine');
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
    assert(['--pack', '--baseline-pack'].includes(process.argv[i]), `unknown option ${process.argv[i]}`);
    assert(process.argv[i + 1], `missing value for ${process.argv[i]}`);
    options.set(process.argv[i], path.resolve(process.argv[i + 1]));
}
const pack = options.get('--pack') ?? path.join(engine, 'data/pack');
const baseline = JSON.parse(readFileSync(path.join(here, 'published.json'), 'utf8'));
const rows = JSON.parse(readFileSync(path.join(here, 'fields.json'), 'utf8'));
const importEngine = relative => import(pathToFileURL(path.join(engine, relative)).href);
const types = {};
for (const name of ['ParamType', 'CategoryType', 'ObjType', 'InvType', 'LocType', 'StructType', 'DbTableType', 'DbRowType', 'SeqType', 'VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'EnumType', 'FontType', 'Component']) {
    types[name] = (await importEngine(`src/cache/config/${name}.ts`)).default;
    types[name].load(pack);
}
const DbTableIndex = (await importEngine('src/cache/config/DbTableIndex.ts')).default;
DbTableIndex.init();
const World = (await importEngine('src/engine/World.ts')).default;
const ScriptProvider = (await importEngine('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await importEngine('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await importEngine('src/engine/script/ScriptState.ts')).default;
const { ScriptOpcodeNameMap } = await importEngine('src/engine/script/ScriptOpcode.ts');
const { ProtectedActivePlayer } = await importEngine('src/engine/script/ScriptPointer.ts');
const Player = (await importEngine('src/engine/entity/Player.ts')).default;
const Loc = (await importEngine('src/engine/entity/Loc.ts')).default;
const { EntityLifeCycle } = await importEngine('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await importEngine('src/engine/entity/PlayerStat.ts');
const ServerTriggerType = (await importEngine('src/engine/script/ServerTriggerType.ts')).default;
const { ParamHelper } = await importEngine('src/cache/config/ParamHelper.ts');
assert(ScriptProvider.load(pack) > 0, 'compiled scripts are loaded');
World.currentTick = 1;

let failures = 0;
let passes = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
        passes++;
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        failures++;
    }
}
function id(type, name) {
    const result = types[type].getId(name);
    assert(result >= 0, `missing packed ${type}/${name}`);
    return result;
}
function valueOf(expected) {
    return expected && typeof expected === 'object' && !Array.isArray(expected) ? id(expected.type, expected.name) : expected;
}
function field(holder, key) {
    if (key.startsWith('param:')) {
        const param = types.ParamType.getByName(key.slice(6));
        assert(param, `packed parameter ${key}`);
        return param.isString() ? ParamHelper.getStringParam(param.id, holder, param.defaultString) : ParamHelper.getIntParam(param.id, holder, param.defaultInt);
    }
    if (key.startsWith('data:')) {
        const table = types.DbTableType.get(holder.tableId);
        const column = table.columnNames.indexOf(key.slice(5));
        assert(column >= 0, `packed column ${key}`);
        return holder.getValue(column, 0);
    }
    return holder[key];
}
assert.equal(rows.length, 77, 'complete restored-row census');
for (const row of rows) {
    check(`ROW ${row.group} ${row.type}/${row.name}/${row.field}`, () => {
        const holder = types[row.type].getByName(row.name);
        assert(holder, `missing packed ${row.type}/${row.name}`);
        assert.deepEqual(field(holder, row.field), valueOf(row.expected));
    });
}
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
check('published and restored client config archive SHA-256', () => {
    const before = options.has('--baseline-pack') ? hash(path.join(options.get('--baseline-pack'), 'client/config')) : baseline.clientConfigSha256;
    const after = hash(path.join(pack, 'client/config'));
    console.log(JSON.stringify({ publishedClientConfigSha256: before, testedClientConfigSha256: after }));
    assert.equal(before, baseline.clientConfigSha256, 'published archive matches the pinned build');
    assert.equal(after, before, 'server-field repairs must not change the client config archive bytes');
});

function script(name) {
    const result = ScriptProvider.getByName(name);
    assert(result, `compiled ${name}`);
    return result;
}
function player() {
    const result = new Player('cfg_other_offline', 0n, 0n);
    result.uid = 1;
    result.pid = 1;
    result.packets = [];
    result.messages = [];
    result.write = packet => result.packets.push(packet);
    result.messageGame = message => result.messages.push(message);
    result.wrappedMessageGame = message => result.messages.push(message);
    return result;
}
function opcode(name) {
    const entry = [...ScriptOpcodeNameMap].find(([, value]) => value === name);
    assert(entry, name);
    return entry[0];
}
check('C10 actual inventory handler accepts pieces only in the dummy board', () => {
    const fixture = player();
    const state = ScriptRunner.init(script('[label,fill_container_water]'), fixture);
    state.pc = state.script.opcodes.indexOf(opcode('INV_ADD'));
    assert(state.pc >= 0);
    const piece = id('ObjType', 'boardgames_draughts_airrune_king');
    const add = inventory => {
        state.pushInt(inventory);
        state.pushInt(piece);
        state.pushInt(1);
        ScriptRunner.HANDLERS[opcode('INV_ADD')](state);
    };
    const board = id('InvType', 'boardgames_boardinv');
    add(board);
    assert.equal(fixture.invTotal(board, piece), 1);
    assert.throws(() => add(id('InvType', 'inv')), /dummyitem in non-dummyinv/);
});
for (const [group, name] of [['C11', 'trawler_rewardinv'], ['C12', 'partyroom_tempinv']]) {
    check(`${group} actual inventory handler permits the inherited unprotected staging write`, () => {
        const fixture = player();
        const state = ScriptRunner.init(script('[label,fill_container_water]'), fixture);
        state.pc = state.script.opcodes.indexOf(opcode('INV_ADD'));
        assert(state.pc >= 0);
        const inv = id('InvType', name);
        const coins = id('ObjType', 'coins');
        for (const value of [inv, coins, 1]) state.pushInt(value);
        ScriptRunner.HANDLERS[opcode('INV_ADD')](state);
        assert.equal(fixture.invTotal(inv, coins), 1);
    });
}
check('C13 compiled wear-slot conflict includes plague-trouser feet', () => {
    const state = ScriptRunner.init(script('[proc,wearpos_conflicts]'), null, null, [id('ObjType', 'plague_trousers'), id('ObjType', 'leather_boots')]);
    assert.equal(ScriptRunner.execute(state), ScriptState.FINISHED);
    assert.equal(state.popInt(), 1);
});
check('C15 loaded vessel resolves both inherited equipment messages', () => {
    const vessel = types.ObjType.getByName('tbwt_karambwan_vessel_loaded_with_karambwanji');
    const equipment = types.StructType.get(field(vessel, 'param:fish_equipment_struct'));
    assert(equipment, 'equipment struct resolves');
    assert.equal(field(equipment, 'param:fish_equipment_failmessage'), 'You need a Karambwan vessel to fish here.');
    assert.equal(field(equipment, 'param:fish_wrong_spot_message'), 'There is nothing suitable for catching with a Karambwan vessel here.');
});
function selectedCookingRow(sourceCategory, gauntlets) {
    const fixture = player();
    fixture.levels[PlayerStat.COOKING] = 99;
    fixture.baseLevels[PlayerStat.COOKING] = 99;
    const raw = id('ObjType', 'raw_swordfish');
    fixture.invAdd(id('InvType', 'inv'), raw, 1);
    if (gauntlets) fixture.invSet(id('InvType', 'worn'), id('ObjType', 'gauntlets_of_cooking'), 1, types.ObjType.getWearPosId('hands'));
    const category = id('CategoryType', sourceCategory);
    let source;
    for (let i = 0; i < types.LocType.count; i++) {
        const loc = types.LocType.get(i);
        if (loc?.category === category && loc.debugname !== 'cooksquestrange') {
            source = loc;
            break;
        }
    }
    assert(source, `packed ${sourceCategory} source`);
    const target = new Loc(0, 3200, 3200, 1, 1, EntityLifeCycle.RESPAWN, source.id, 10, 0);
    const state = ScriptRunner.init(script('[label,attempt_cook_item]'), fixture, target, [raw]);
    state.pointerAdd(ProtectedActivePlayer[0]);
    state.execution = ScriptState.RUNNING;
    for (let count = 0; count < 10000; count++) {
        if (state.script.name === '[label,cook_item]' && state.pc === -1) return state.intLocals.slice(0, 2);
        assert.equal(state.execution, ScriptState.RUNNING, 'selector finishes before a product/roll is needed');
        state.opcount++;
        const command = state.script.opcodes[++state.pc];
        const handler = ScriptRunner.HANDLERS[command];
        assert(handler, `production opcode ${command}`);
        handler(state);
    }
    assert.fail('cooking selector did not reach cook_item');
}
for (const [source, gauntlets, expected] of [
    ['cooking_fire', false, [18, 292]],
    ['cooking_fire', true, [30, 310]],
    ['cooking_oven', false, [30, 310]],
    ['cooking_oven', true, [30, 310]]
]) {
    check(`C16 compiled selector ${source}, gauntlets=${gauntlets}`, () => {
        const selected = Array.from(selectedCookingRow(source, gauntlets));
        console.log(JSON.stringify({ source, gauntlets, selected }));
        assert.deepEqual(selected, expected);
    });
}
check('C20 packed tap dispatch selects the existing water-source reader', () => {
    const tap = types.LocType.getByName('castlewars_tap');
    assert(tap);
    const handler = ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, tap.id, tap.category);
    assert(handler);
    assert.equal(handler.fileName, 'water_sources.rs2');
});
console.log(`cfg-other: ${passes} passed; ${failures} failed; 77 restored rows; no server started`);
process.exit(failures ? 1 : 0);
