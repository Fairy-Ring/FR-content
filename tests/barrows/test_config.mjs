#!/usr/bin/env node
// Offline S00 contract: source-backed config joins and every mapped tunnel parent placement.
// Run from content: node tests/barrows/test_config.mjs --content-root .
// The --mutant modes alter only an in-memory config string and must fail without touching the root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../..');
const ENUM_PATH = 'scripts/minigames/game_barrows/configs/barrows.enum';
const PARAM_PATH = 'scripts/minigames/game_barrows/configs/barrows.param';

let contentRoot = DEFAULT_ROOT;
let mutant = null;
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--content-root') {
        assert(process.argv[i + 1], '--content-root requires a path');
        contentRoot = path.resolve(process.argv[++i]);
    } else if (process.argv[i] === '--mutant') {
        assert(process.argv[i + 1], '--mutant requires a name');
        mutant = process.argv[++i];
    } else {
        assert.fail(`unknown argument: ${process.argv[i]}`);
    }
}
assert([null, 'wrong-brother-join', 'reversed-lock-polarity'].includes(mutant), `unknown mutant: ${mutant}`);

function readText(relativePath) {
    let text = fs.readFileSync(path.join(contentRoot, relativePath), 'utf8');
    if (relativePath !== ENUM_PATH || mutant === null) return text;

    if (mutant === 'wrong-brother-join') {
        const original = 'val=barrow_ahrim_sarcophagus,barrows_ahrim';
        assert(text.includes(original), 'wrong-brother-join mutant source anchor is missing');
        return text.replace(original, 'val=barrow_ahrim_sarcophagus,barrows_dharok');
    }

    const original = 'val=0,unlocked\nval=1,locked';
    assert(text.includes(original), 'reversed-lock-polarity mutant source anchor is missing');
    return text.replace(original, 'val=0,locked\nval=1,unlocked');
}

function parseSections(text, source) {
    const sections = new Map();
    const counts = new Map();
    let current = null;
    for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue;
        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) {
            current = header[1];
            counts.set(current, (counts.get(current) ?? 0) + 1);
            sections.set(current, new Map());
            continue;
        }
        const equals = line.indexOf('=');
        if (equals < 1 || current === null) continue;
        const key = line.slice(0, equals).trim();
        const value = line.slice(equals + 1).trim();
        const values = sections.get(current).get(key) ?? [];
        values.push(value);
        sections.get(current).set(key, values);
    }
    return { sections, counts, source };
}

function section(parsed, name) {
    assert.equal(parsed.counts.get(name), 1, `${parsed.source}: expected exactly one [${name}] section`);
    const result = parsed.sections.get(name);
    assert(result, `${parsed.source}: missing [${name}]`);
    return result;
}

function values(fields, key) {
    return fields.get(key) ?? [];
}

function one(fields, key, source) {
    const found = values(fields, key);
    assert.equal(found.length, 1, `${source}: expected exactly one ${key}, got ${found.length}`);
    return found[0];
}

function parseIdPack(text, source) {
    const byId = new Map();
    const byName = new Map();
    for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;
        const match = line.match(/^(\d+)=(.+)$/);
        assert(match, `${source}:${index + 1}: malformed id mapping ${line}`);
        const id = Number(match[1]);
        const name = match[2];
        assert(!byId.has(id), `${source}:${index + 1}: duplicate id ${id}`);
        assert(!byName.has(name), `${source}:${index + 1}: duplicate name ${name}`);
        byId.set(id, name);
        byName.set(name, id);
    }
    return { byId, byName };
}

function enumValues(parsed, sectionName) {
    const fields = section(parsed, sectionName);
    const result = new Map();
    for (const value of values(fields, 'val')) {
        const comma = value.indexOf(',');
        assert(comma > 0, `${parsed.source} [${sectionName}]: malformed val=${value}`);
        const key = value.slice(0, comma);
        assert(!result.has(key), `${parsed.source} [${sectionName}]: duplicate key ${key}`);
        result.set(key, value.slice(comma + 1));
    }
    return result;
}

function paramValues(fields, source) {
    const result = new Map();
    for (const value of values(fields, 'param')) {
        const comma = value.indexOf(',');
        assert(comma > 0, `${source}: malformed param=${value}`);
        const key = value.slice(0, comma);
        assert(!result.has(key), `${source}: duplicate param ${key}`);
        result.set(key, value.slice(comma + 1));
    }
    return result;
}

function sortedRows(rows) {
    return rows.map(row => [row.id, row.x, row.z, row.level, row.raw].join('\t')).sort();
}

function mapLocRows(text, source) {
    const mapMatch = path.basename(source).match(/^m(\d+)_(\d+)\.jm2$/);
    assert(mapMatch, `${source}: map basename does not identify a region`);
    const baseX = Number(mapMatch[1]) * 64;
    const baseZ = Number(mapMatch[2]) * 64;
    const rows = [];
    let sectionName = '';
    for (const [index, line] of text.split(/\r?\n/).entries()) {
        const header = line.match(/^====\s*(.*?)\s*====$/);
        if (header) {
            sectionName = header[1];
            continue;
        }
        if (sectionName !== 'LOC') continue;
        const match = line.match(/^(\d+)\s+(\d+)\s+(\d+):\s+(\d+(?:\s+\d+)*)$/);
        if (!match) continue;
        const level = Number(match[1]);
        const localX = Number(match[2]);
        const localZ = Number(match[3]);
        const raw = match[4];
        rows.push({
            id: Number(raw.split(/\s+/)[0]),
            x: baseX + localX,
            z: baseZ + localZ,
            level,
            raw,
            line: index + 1
        });
    }
    return rows;
}

const PARAM_TYPES = new Map([
    ['barrows_brother', 'npc'],
    ['barrows_slain_varbit', 'string'],
    ['barrows_crypt_entry', 'coord'],
    ['barrows_surface_exit', 'coord'],
    ['barrows_room_edge_lock', 'int'],
    ['barrows_door_open_state', 'int'],
    ['barrows_door_locked_state', 'int']
]);
const PARAM_DEFAULTS = new Map([
    ['barrows_brother', 'null'],
    ['barrows_slain_varbit', 'null'],
    ['barrows_crypt_entry', 'null'],
    ['barrows_surface_exit', 'null'],
    ['barrows_room_edge_lock', 'null'],
    ['barrows_door_open_state', '0'],
    ['barrows_door_locked_state', '1']
]);


const ENUM_IDS = new Map([
    [154, 'barrows_sarcophagus_brother'],
    [155, 'barrows_brother_slain_varbit'],
    [156, 'barrows_brother_crypt_entry'],
    [157, 'barrows_stair_surface_exit'],
    [158, 'barrows_room_edges_by_lock'],
    [159, 'barrows_door_lock_state']
]);
const ENUM_SIGNATURES = new Map([
    ['barrows_sarcophagus_brother', ['loc', 'npc']],
    ['barrows_brother_slain_varbit', ['npc', 'string']],
    ['barrows_brother_crypt_entry', ['npc', 'coord']],
    ['barrows_stair_surface_exit', ['loc', 'coord']],
    ['barrows_room_edges_by_lock', ['int', 'string']],
    ['barrows_door_lock_state', ['int', 'string']]
]);


const PARAM_IDS = new Map([
    [244, 'barrows_brother'],
    [245, 'barrows_slain_varbit'],
    [246, 'barrows_crypt_entry'],
    [247, 'barrows_surface_exit'],
    [248, 'barrows_room_edge_lock'],
    [249, 'barrows_door_open_state'],
    [250, 'barrows_door_locked_state']
]);

const ENCOUNTERS = [
    { brother: 'barrows_ahrim', npcId: 2025, sarc: 'barrow_ahrim_sarcophagus', sarcId: 6821, slain: 'barrows_killed_ahrim', slainId: 457, entry: '3_55_151_37_39', stair: 'barrows_stairs_ahrim', exit: '0_55_51_45_25' },
    { brother: 'barrows_dharok', npcId: 2026, sarc: 'barrow_dharok_sarcophagus', sarcId: 6771, slain: 'barrows_killed_dharok', slainId: 458, entry: '3_55_151_36_54', stair: 'barrows_stairs_dharok', exit: '0_55_51_55_34' },
    { brother: 'barrows_guthan', npcId: 2027, sarc: 'barrow_guthan_sarcophagus', sarcId: 6773, slain: 'barrows_killed_guthan', slainId: 459, entry: '3_55_151_15_41', stair: 'barrows_stairs_guthan', exit: '0_55_51_57_19' },
    { brother: 'barrows_karil', npcId: 2028, sarc: 'barrow_karil_sarcophagus', sarcId: 6822, slain: 'barrows_killed_karil', slainId: 460, entry: '3_55_151_27_21', stair: 'barrows_stairs_karil', exit: '0_55_51_46_12' },
    { brother: 'barrows_torag', npcId: 2029, sarc: 'barrow_torag_sarcophagus', sarcId: 6772, slain: 'barrows_killed_torag', slainId: 461, entry: '3_55_151_45_20', stair: 'barrows_stairs_torag', exit: '0_55_51_33_19' },
    { brother: 'barrows_verac', npcId: 2030, sarc: 'barrow_verac_sarcophagus', sarcId: 6823, slain: 'barrows_killed_verac', slainId: 462, entry: '3_55_151_57_39', stair: 'barrows_stairs_verac', exit: '0_55_51_37_34' }
];

const VARBIT_LAYOUTS = [
    ['barrows_killed_ahrim', 457, 'barrows_kills', 0, 0],
    ['barrows_killed_dharok', 458, 'barrows_kills', 1, 1],
    ['barrows_killed_guthan', 459, 'barrows_kills', 2, 2],
    ['barrows_killed_karil', 460, 'barrows_kills', 3, 3],
    ['barrows_killed_torag', 461, 'barrows_kills', 4, 4],
    ['barrows_killed_verac', 462, 'barrows_kills', 5, 5],
    ['barrows_killed_monster', 463, 'barrows_kills', 6, 15],
    ['barrows_killed_count', 464, 'barrows_kills', 17, 31],
    ['barrows_chamber_a', 465, 'barrows', 6, 6],
    ['barrows_chamber_c', 466, 'barrows', 7, 7],
    ['barrows_chamber_g', 467, 'barrows', 8, 8],
    ['barrows_chamber_i', 468, 'barrows', 9, 9],
    ...'abcdefghijklmnop'.split('').map((letter, index) => [`barrows_door_${letter}`, 469 + index, 'barrows', 10 + index, 10 + index]),
    ['barrows_puzzle', 485, 'barrows', 29, 31],
    ['barrows_chest_open', 1394, 'barrows_kills', 16, 16]
];

const ROOM_EDGE_ENDPOINTS = new Map([
    [469, 'nw>north_outside|ne>north_outside'],
    [470, 'nw>west_outside|sw>west_outside'],
    [471, 'nw>w'],
    [472, 'nw>n'],
    [473, 'n>center'],
    [474, 'n>ne'],
    [475, 'ne>e'],
    [476, 'ne>east_outside|se>east_outside'],
    [477, 'w>center'],
    [478, 'center>e'],
    [479, 'w>sw'],
    [480, 'center>s'],
    [481, 'e>se'],
    [482, 'sw>s'],
    [483, 's>se'],
    [484, 'sw>south_outside|se>south_outside']
]);

const EXPECTED_DOORS = [
    [6717, 3528, 9677, '6717 0 2'], [6736, 3528, 9678, '6736 0 2'],
    [6717, 3528, 9711, '6717 0 2'], [6736, 3528, 9712, '6736 0 2'],
    [6750, 3534, 9671, '6750 0 1'], [6726, 3534, 9684, '6726 0 3'],
    [6745, 3534, 9688, '6745 0 1'], [6718, 3534, 9701, '6718 0 3'],
    [6737, 3534, 9705, '6737 0 1'], [6716, 3534, 9718, '6716 0 3'],
    [6731, 3535, 9671, '6731 0 1'], [6745, 3535, 9684, '6745 0 3'],
    [6726, 3535, 9688, '6726 0 1'], [6737, 3535, 9701, '6737 0 3'],
    [6718, 3535, 9705, '6718 0 1'], [6735, 3535, 9718, '6735 0 3'],
    [6748, 3541, 9677, '6748 0'], [6729, 3541, 9678, '6729 0'],
    [6743, 3541, 9694, '6743 0'], [6724, 3541, 9695, '6724 0'],
    [6738, 3541, 9711, '6738 0'], [6719, 3541, 9712, '6719 0'],
    [6729, 3545, 9677, '6729 0 2'], [6748, 3545, 9678, '6748 0 2'],
    [6724, 3545, 9694, '6724 0 2'], [6743, 3545, 9695, '6743 0 2'],
    [6719, 3545, 9711, '6719 0 2'], [6738, 3545, 9712, '6738 0 2'],
    [6727, 3551, 9684, '6727 0 3'], [6746, 3551, 9688, '6746 0 1'],
    [6720, 3551, 9701, '6720 0 3'], [6739, 3551, 9705, '6739 0 1'],
    [6746, 3552, 9684, '6746 0 3'], [6727, 3552, 9688, '6727 0 1'],
    [6739, 3552, 9701, '6739 0 3'], [6720, 3552, 9705, '6720 0 1'],
    [6749, 3558, 9677, '6749 0'], [6730, 3558, 9678, '6730 0'],
    [6744, 3558, 9694, '6744 0'], [6725, 3558, 9695, '6725 0'],
    [6740, 3558, 9711, '6740 0'], [6721, 3558, 9712, '6721 0'],
    [6730, 3562, 9677, '6730 0 2'], [6749, 3562, 9678, '6749 0 2'],
    [6725, 3562, 9694, '6725 0 2'], [6744, 3562, 9695, '6744 0 2'],
    [6721, 3562, 9711, '6721 0 2'], [6740, 3562, 9712, '6740 0 2'],
    [6750, 3568, 9671, '6750 0 1'], [6728, 3568, 9684, '6728 0 3'],
    [6747, 3568, 9688, '6747 0 1'], [6722, 3568, 9701, '6722 0 3'],
    [6741, 3568, 9705, '6741 0 1'], [6716, 3568, 9718, '6716 0 3'],
    [6731, 3569, 9671, '6731 0 1'], [6747, 3569, 9684, '6747 0 3'],
    [6728, 3569, 9688, '6728 0 1'], [6741, 3569, 9701, '6741 0 3'],
    [6722, 3569, 9705, '6722 0 1'], [6735, 3569, 9718, '6735 0 3'],
    [6742, 3575, 9677, '6742 0'], [6723, 3575, 9678, '6723 0'],
    [6742, 3575, 9711, '6742 0'], [6723, 3575, 9712, '6723 0']
].map(([id, x, z, raw]) => ({ id, x, z, level: 0, raw }));

const EXPECTED_OTHER_LOOP_LOCS = [
    [6709, 3534, 9712, 0, '6709 10'], [6710, 3568, 9712, 0, '6710 10'],
    [6711, 3534, 9678, 0, '6711 10'], [6712, 3568, 9678, 0, '6712 10'],
    [10284, 3551, 9695, 0, '10284 10'],
    [6704, 3534, 9705, 3, '6704 10'], [6705, 3546, 9685, 3, '6705 10'],
    [6703, 3557, 9718, 3, '6703 10 1'], [6702, 3558, 9703, 3, '6702 10 1'],
    [6706, 3565, 9683, 3, '6706 10 3'], [6707, 3578, 9703, 3, '6707 10 2'],
    [6773, 3538, 9703, 3, '6773 10 1'], [6822, 3550, 9682, 3, '6822 10'],
    [6771, 3554, 9714, 3, '6771 10 3'], [6821, 3555, 9698, 3, '6821 10'],
    [6772, 3569, 9685, 3, '6772 10'], [6823, 3573, 9705, 3, '6823 10']
].map(([id, x, z, level, raw]) => ({ id, x, z, level, raw }));

const varpPack = parseIdPack(readText('pack/varp.pack'), 'pack/varp.pack');
const varbitPack = parseIdPack(readText('pack/varbit.pack'), 'pack/varbit.pack');
const locPack = parseIdPack(readText('pack/loc.pack'), 'pack/loc.pack');
const npcPack = parseIdPack(readText('pack/npc.pack'), 'pack/npc.pack');
const paramPack = parseIdPack(readText('pack/param.pack'), 'pack/param.pack');
const enumPack = parseIdPack(readText('pack/enum.pack'), 'pack/enum.pack');
const interfacePack = parseIdPack(readText('pack/interface.pack'), 'pack/interface.pack');

assert.equal(varpPack.byId.get(452), 'barrows');
assert.equal(varpPack.byId.get(453), 'barrows_kills');
const allVarps = parseSections(readText('scripts/_unpack/377/all.varp'), 'all.varp');
for (const name of ['barrows', 'barrows_kills']) {
    const fields = section(allVarps, name);
    assert.equal(one(fields, 'transmit', 'all.varp'), 'yes', `[${name}] transmit`);
    assert.equal(one(fields, 'scope', 'all.varp'), 'perm', `[${name}] scope`);
}
const barrowsVarps = [...varpPack.byId].filter(([, name]) => name.startsWith('barrows')).sort(([left], [right]) => left - right);
assert.deepEqual(barrowsVarps, [[452, 'barrows'], [453, 'barrows_kills']]);
for (const id of [650, 651, 652, 653]) {
    assert(!varpPack.byId.get(id)?.startsWith('barrows'), `reserved varp ${id} was assigned to Barrows`);
}
for (const id of [654, 659, 660]) {
    const name = `varp${id}_unused`;
    assert.equal(varpPack.byId.get(id), name, `original unused varp ${id} identity changed`);
    assert.equal(values(section(allVarps, name), 'scope').length, 0, `${name} must remain unnamed and untouched`);
    assert.equal(values(section(allVarps, name), 'transmit').length, 0, `${name} must remain untouched`);
}

const allVarbits = parseSections(readText('scripts/_unpack/377/all.varbit'), 'all.varbit');
for (const [name, id, basevar, startbit, endbit] of VARBIT_LAYOUTS) {
    assert.equal(varbitPack.byId.get(id), name, `original varbit id ${id}`);
    const fields = section(allVarbits, name);
    assert.equal(one(fields, 'basevar', 'all.varbit'), basevar, `[${name}] basevar`);
    assert.equal(one(fields, 'startbit', 'all.varbit'), String(startbit), `[${name}] startbit`);
    assert.equal(one(fields, 'endbit', 'all.varbit'), String(endbit), `[${name}] endbit`);
}
assert.equal(VARBIT_LAYOUTS.length, 30, 'original Barrows varbit inventory must remain complete');

for (const [id, name] of PARAM_IDS) assert.equal(paramPack.byId.get(id), name, `new param id ${id}`);
for (const [id, name] of ENUM_IDS) assert.equal(enumPack.byId.get(id), name, `new enum id ${id}`);
assert.equal(Math.max(...paramPack.byId.keys()), 250, 'Barrows params must append after original id 243');
assert.equal(Math.max(...enumPack.byId.keys()), 159, 'Barrows enums must append after original id 153');

const params = parseSections(readText(PARAM_PATH), PARAM_PATH);
assert.deepEqual([...params.sections.keys()], [...PARAM_TYPES.keys()]);
for (const [name, type] of PARAM_TYPES) assert.equal(one(section(params, name), 'type', PARAM_PATH), type, `[${name}] type`);
for (const [name, defaultValue] of PARAM_DEFAULTS) assert.equal(one(section(params, name), 'default', PARAM_PATH), defaultValue, `[${name}] default`);


const enumText = readText(ENUM_PATH);
const enums = parseSections(enumText, ENUM_PATH);
assert.deepEqual([...enums.sections.keys()], [...ENUM_IDS.values()]);
for (const [id, name] of ENUM_IDS) assert.equal(enumPack.byName.get(name), id, `[${name}] pack ID`);
for (const [name, [inputType, outputType]] of ENUM_SIGNATURES) {
    const fields = section(enums, name);
    assert.equal(one(fields, 'inputtype', ENUM_PATH), inputType, `[${name}] input type`);
    assert.equal(one(fields, 'outputtype', ENUM_PATH), outputType, `[${name}] output type`);
}

const noModelConfigs = `${enumText}\n${readText(PARAM_PATH)}`;
assert(!/\bmodel\w*\s*=|\b4623\b|\b45(?:44|45|46|47|48|49|50|51|52|53|54|55|56|57)\b/i.test(noModelConfigs), 'S00 must not add guessed puzzle model joins');
assert(!fs.existsSync(path.join(contentRoot, 'scripts/minigames/game_barrows/configs/barrows.constant')), 'S00 does not allocate server-only constants');

const expectedSarcToBrother = new Map(ENCOUNTERS.map(({ sarc, brother }) => [sarc, brother]));
const expectedSlainByBrother = new Map(ENCOUNTERS.map(({ brother, slain }) => [brother, slain]));
const expectedEntryByBrother = new Map(ENCOUNTERS.map(({ brother, entry }) => [brother, entry]));
const expectedExitByStair = new Map(ENCOUNTERS.map(({ stair, exit }) => [stair, exit]));
assert.deepEqual(enumValues(enums, 'barrows_sarcophagus_brother'), expectedSarcToBrother);
assert.deepEqual(enumValues(enums, 'barrows_brother_slain_varbit'), expectedSlainByBrother);
assert.deepEqual(enumValues(enums, 'barrows_brother_crypt_entry'), expectedEntryByBrother);
assert.deepEqual(enumValues(enums, 'barrows_stair_surface_exit'), expectedExitByStair);
const allLoc = parseSections(readText('scripts/_unpack/377/all.loc'), 'all.loc');
const allNpcs = parseSections(readText('scripts/_unpack/377/all.npc'), 'all.npc');
const stairsConfig = parseSections(readText('scripts/ladders+stairs/configs/stairs.loc'), 'stairs.loc');

for (const encounter of ENCOUNTERS) {
    assert.equal(locPack.byId.get(encounter.sarcId), encounter.sarc, `sarcophagus loc id ${encounter.sarcId}`);
    assert.equal(npcPack.byName.get(encounter.brother), encounter.npcId, `${encounter.brother} id`);
    assert.equal(varbitPack.byName.get(encounter.slain), encounter.slainId, `${encounter.slain} id`);
    section(allNpcs, encounter.brother);
    const sarcFields = section(allLoc, encounter.sarc);
    assert.equal(one(sarcFields, 'op1', 'all.loc'), 'Search', `[${encounter.sarc}] action`);
    const sarcParams = paramValues(sarcFields, `[${encounter.sarc}]`);
    assert.equal(sarcParams.get('barrows_brother'), encounter.brother, `[${encounter.sarc}] brother join`);
    assert.equal(sarcParams.get('barrows_slain_varbit'), encounter.slain, `[${encounter.sarc}] slain-bit join`);
    assert.equal(sarcParams.get('barrows_crypt_entry'), encounter.entry, `[${encounter.sarc}] entry join`);
    assert.equal(sarcParams.size, 3, `[${encounter.sarc}] unexpected Barrows params`);

    const stairFields = section(stairsConfig, encounter.stair);
    const stairParams = paramValues(stairFields, `[${encounter.stair}]`);
    assert.equal(stairParams.get('barrows_surface_exit'), encounter.exit, `[${encounter.stair}] inverse-exit param`);
    assert.equal(stairParams.size, 1, `[${encounter.stair}] unexpected Barrows params`);
}

const digText = readText('scripts/minigames/game_barrows/scripts/barrows_dig.rs2');
const digDestinations = new Map();
const digPattern = /~barrows_dig_dest\(([^)]+)\);\s*\/\/\s*(Ahrim|Dharok|Guthan|Karil|Torag|Verac)\b/g;
for (const match of digText.matchAll(digPattern)) digDestinations.set(`barrows_${match[2].toLowerCase()}`, match[1]);
assert.equal(digDestinations.size, 6, 'original Dig must retain its six brother destinations');
for (const [brother, entry] of expectedEntryByBrother) assert.equal(digDestinations.get(brother), entry, `[${brother}] entry must match barrows_dig.rs2`);

const stairsText = readText('scripts/ladders+stairs/scripts/stairs.rs2');
const stairsDestinations = new Map();
let currentStair = null;
for (const line of stairsText.split(/\r?\n/)) {
    const header = line.match(/^\[oploc1,barrows_stairs_(ahrim|dharok|guthan|karil|torag|verac)\]$/);
    if (header) currentStair = `barrows_stairs_${header[1]}`;
    else if (/^\[/.test(line)) currentStair = null;
    const jump = line.match(/p_telejump\((0_\d+_\d+_\d+_\d+)\)/);
    if (currentStair && jump) stairsDestinations.set(currentStair, jump[1]);
}
assert.equal(stairsDestinations.size, 6, 'original stairs must retain six inverse destinations');
for (const [stair, exit] of expectedExitByStair) assert.equal(stairsDestinations.get(stair), exit, `[${stair}] exit must match stairs.rs2`);

const roomEdges = enumValues(enums, 'barrows_room_edges_by_lock');
assert.deepEqual(new Map([...roomEdges].map(([key, value]) => [Number(key), value])), ROOM_EDGE_ENDPOINTS);
assert.deepEqual(enumValues(enums, 'barrows_door_lock_state'), new Map([['0', 'unlocked'], ['1', 'locked']]));
assert.equal(ROOM_EDGE_ENDPOINTS.size, 16, 'one enum key per original lock bit');
const roomPoints = new Map([
    ['nw', [0, 2]], ['n', [1, 2]], ['ne', [2, 2]],
    ['w', [0, 1]], ['center', [1, 1]], ['e', [2, 1]],
    ['sw', [0, 0]], ['s', [1, 0]], ['se', [2, 0]]
]);
const outsideDirections = new Map([
    ['north_outside', ['z', 2]], ['south_outside', ['z', 0]],
    ['west_outside', ['x', 0]], ['east_outside', ['x', 2]]
]);
let internalEdges = 0;
let outerEdges = 0;
for (const [lockId, endpointList] of ROOM_EDGE_ENDPOINTS) {
    const endpoints = endpointList.split('|');
    assert.equal(endpoints.length, [469, 470, 476, 484].includes(lockId) ? 2 : 1, `lock ${lockId} endpoint reuse`);
    for (const endpoint of endpoints) {
        const [left, right] = endpoint.split('>');
        assert(left && right, `malformed room edge ${endpoint}`);
        if (roomPoints.has(left) && roomPoints.has(right)) {
            const [lx, lz] = roomPoints.get(left);
            const [rx, rz] = roomPoints.get(right);
            assert.equal(Math.abs(lx - rx) + Math.abs(lz - rz), 1, `nonadjacent rooms in ${endpoint}`);
            internalEdges++;
        } else {
            const room = roomPoints.has(left) ? left : right;
            const outside = outsideDirections.has(left) ? left : right;
            assert(roomPoints.has(room) && outsideDirections.has(outside), `invalid outer endpoint ${endpoint}`);
            const [x, z] = roomPoints.get(room);
            const [axis, edge] = outsideDirections.get(outside);
            assert.equal(axis === 'x' ? x : z, edge, `room ${room} is not on ${outside}`);
            outerEdges++;
        }
    }
}
assert.equal(internalEdges, 12, 'all twelve internal room edges');
assert.equal(outerEdges, 8, 'all eight outer openings');

const doorParentIds = new Set([
    ...Array.from({ length: 16 }, (_, index) => 6716 + index),
    ...Array.from({ length: 16 }, (_, index) => 6735 + index)
]);
const doorSections = [...allLoc.sections.keys()].filter(name => /^barrows_door_[a-p]_[rl]$/.test(name));
assert.equal(doorSections.length, 32, 'all original right/left door parent configs');
for (const id of doorParentIds) {
    const rightSide = id <= 6731;
    const letterIndex = rightSide ? id - 6716 : id - 6735;
    const letter = String.fromCharCode('a'.charCodeAt(0) + letterIndex);
    const side = rightSide ? 'r' : 'l';
    const name = `barrows_door_${letter}_${side}`;
    assert.equal(locPack.byId.get(id), name, `original door parent loc id ${id}`);
    const fields = section(allLoc, name);
    const lockName = `barrows_door_${letter}`;
    assert.equal(one(fields, 'multivar', 'all.loc'), lockName, `[${name}] original multivar`);
    assert.deepEqual(values(fields, 'multiloc'), [`0,barrows_door_unlocked_${side}`, `1,barrows_door_locked_${side}`], `[${name}] 0 unlocked / 1 locked children`);
    const paramsForDoor = paramValues(fields, `[${name}]`);
    assert.equal(paramsForDoor.get('barrows_room_edge_lock'), String(469 + letterIndex), `[${name}] lock-bit param`);
    assert.equal(paramsForDoor.get('barrows_door_open_state'), '0', `[${name}] open polarity`);
    assert.equal(paramsForDoor.get('barrows_door_locked_state'), '1', `[${name}] locked polarity`);
    assert.equal(paramsForDoor.size, 3, `[${name}] unexpected Barrows params`);
}

const mapPath = 'maps/m55_151.jm2';
const mappedLocs = mapLocRows(readText(mapPath), mapPath);
const loopIds = new Set([
    ...doorParentIds,
    ...Array.from({ length: 16 }, (_, index) => 6751 + index),
    ...Array.from({ length: 4 }, (_, index) => 6709 + index),
    ...Array.from({ length: 6 }, (_, index) => 6702 + index),
    6771, 6772, 6773, 6821, 6822, 6823, 10284
]);
const loopPlacements = mappedLocs.filter(row => loopIds.has(row.id));
const expectedLoopPlacements = [...EXPECTED_DOORS, ...EXPECTED_OTHER_LOOP_LOCS];
assert.deepEqual(sortedRows(loopPlacements), sortedRows(expectedLoopPlacements), 'all door, ladder, stair, sarcophagus, and chest placements/rotations must match the current map');
assert.equal(loopPlacements.filter(row => row.id >= 6751 && row.id <= 6766).length, 0, 'no unplaced rockslide may be inferred');
assert.equal(loopPlacements.filter(row => doorParentIds.has(row.id)).length, 64, 'all 64 placed door parent rows');
for (const id of [6713, 6714, 6715, 6732, 6733, 6734]) assert.equal(mappedLocs.filter(row => row.id === id).length, 0, `multi-loc child ${id} is not directly placed`);

for (const row of loopPlacements.filter(row => doorParentIds.has(row.id))) {
    const rightSide = row.id <= 6731;
    const letterIndex = rightSide ? row.id - 6716 : row.id - 6735;
    const lockId = 469 + letterIndex;
    const sectionName = `barrows_door_${String.fromCharCode('a'.charCodeAt(0) + letterIndex)}_${rightSide ? 'r' : 'l'}`;
    const fields = section(allLoc, sectionName);
    assert.equal(paramValues(fields, `[${sectionName}]`).get('barrows_room_edge_lock'), String(lockId), `map row ${row.line} must point at its declared lock edge`);
}

assert.equal(interfacePack.byId.get(4535), 'kill_count', 'original kill_count interface id');
assert.equal(interfacePack.byId.get(4543), 'next_shape', 'original next_shape interface id');
const interfaceInventory = readText('scripts/interfaces/kill_count.if') + readText('scripts/interfaces/next_shape.if');
assert(interfaceInventory.includes('push_varbit,barrows_killed_count'), 'kill_count retains its original counter field');
assert(!/barrows_(?:puzzle_)?model|model\s*=\s*\d+/i.test(interfaceInventory), 'S00 does not add puzzle-model identities to original interfaces');
const workflow = readText('.github/workflows/content.yml');
const registrations = workflow.match(/^[ \t]*run_test tests\/barrows\/test_config\.mjs(?:\s|$)/gm) ?? [];
assert.equal(registrations.length, 1, 'the workflow must register this offline test exactly once');

console.log(`Barrows S00 config/map contract passed for ${contentRoot}`);
