#!/usr/bin/env node
// Offline S00/S04 contract: source-backed config joins and every mapped tunnel parent placement.
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
assert([null, 'wrong-brother-join', 'reversed-lock-polarity', 'wrong-door-lock', 'swapped-parent-polarity'].includes(mutant), `unknown mutant: ${mutant}`);

function readText(relativePath) {
    const text = fs.readFileSync(path.join(contentRoot, relativePath), 'utf8');
    if (relativePath === ENUM_PATH && mutant === 'wrong-brother-join') {
        const original = 'val=barrow_ahrim_sarcophagus,barrows_ahrim';
        assert(text.includes(original), 'wrong-brother-join mutant source anchor is missing');
        return text.replace(original, 'val=barrow_ahrim_sarcophagus,barrows_dharok');
    }
    if (relativePath === ENUM_PATH && mutant === 'reversed-lock-polarity') {
        const original = 'val=0,unlocked\nval=1,locked';
        assert(text.includes(original), 'reversed-lock-polarity mutant source anchor is missing');
        return text.replace(original, 'val=0,locked\nval=1,unlocked');
    }
    if (relativePath === 'scripts/_unpack/377/all.loc' && ['wrong-door-lock', 'swapped-parent-polarity'].includes(mutant)) {
        const original = text.match(/\[barrows_door_e_r\][\s\S]*?(?=\n\[)/)?.[0];
        assert(original, `${mutant} parent section is missing`);
        let changed;
        if (mutant === 'wrong-door-lock') {
            assert(original.includes('multivar=barrows_door_e\n') && original.includes('param=barrows_room_edge_lock,473\n'), 'wrong-door-lock source anchors are missing');
            changed = original.replace('multivar=barrows_door_e\n', 'multivar=barrows_door_f\n')
                .replace('param=barrows_room_edge_lock,473\n', 'param=barrows_room_edge_lock,474\n');
        } else {
            const polarity = 'multiloc=0,barrows_door_unlocked_r\nmultiloc=1,barrows_door_locked_r';
            assert(original.includes(polarity), 'swapped-parent-polarity source anchor is missing');
            changed = original.replace(polarity, 'multiloc=0,barrows_door_locked_r\nmultiloc=1,barrows_door_unlocked_r');
        }
        return text.replace(original, changed);
    }
    return text;
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
    for (const [index, value] of values(fields, 'val').entries()) {
        if (one(fields, 'inputtype', parsed.source) === 'autoint') {
            result.set(String(index), value);
            continue;
        }
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


const ENUM_SIGNATURES = new Map([
    ['barrows_sarcophagus_brother', ['loc', 'npc']],
    ['barrows_brother_slain_varbit', ['npc', 'string']],
    ['barrows_brother_crypt_entry', ['npc', 'coord']],
    ['barrows_stair_surface_exit', ['loc', 'coord']],
    ['barrows_room_edges_by_lock', ['int', 'string']],
    ['barrows_door_lock_state', ['int', 'string']],
    ['barrows_monster_level', ['npc', 'int']],
    ['barrows_door_class_npc', ['autoint', 'npc']],
    ['barrows_door_draw_class', ['int', 'string']],
    ['barrows_central_lock_bit', ['int', 'int']],
    ['barrows_layout_locks', ['int', 'int']],
    ['barrows_layout_corridor_count', ['int', 'int']],
    ['barrows_ladder_landing', ['int', 'coord']],
    ['barrows_identity_brother', ['int', 'npc']],
    ['barrows_face_object', ['int', 'obj']],
    ['barrows_face_slot', ['int', 'component']]
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

// Names only: coordinates come from the four mapped corner ladders and the chest.
const ROOM_NAMES = {
    rows: [['nw', 'n', 'ne'], ['w', 'center', 'e'], ['sw', 's', 'se']],
    north: 'north_outside', south: 'south_outside',
    west: 'west_outside', east: 'east_outside'
};

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
assert.deepEqual(barrowsVarps, [[452, 'barrows'], [453, 'barrows_kills'], [654, 'barrows_state'], [659, 'barrows_generation'], [660, 'barrows_countdowns']]);
for (const id of [650, 651, 652, 653]) {
    assert(!varpPack.byId.get(id)?.startsWith('barrows'), `reserved varp ${id} was assigned to Barrows`);
}
for (const [id, name] of [[654, 'barrows_state'], [659, 'barrows_generation'], [660, 'barrows_countdowns']]) {
    assert.equal(varpPack.byId.get(id), name, `allocated server varp ${id}`);
    const fields = section(allVarps, name);
    assert.equal(one(fields, 'scope', 'all.varp'), 'perm', `[${name}] scope`);
    assert.equal(one(fields, 'transmit', 'all.varp'), 'no', `[${name}] transmit`);
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


const params = parseSections(readText(PARAM_PATH), PARAM_PATH);
assert.deepEqual([...params.sections.keys()], [...PARAM_TYPES.keys()]);
for (const [name, type] of PARAM_TYPES) assert.equal(one(section(params, name), 'type', PARAM_PATH), type, `[${name}] type`);
for (const [name, defaultValue] of PARAM_DEFAULTS) assert.equal(one(section(params, name), 'default', PARAM_PATH), defaultValue, `[${name}] default`);


const enumText = readText(ENUM_PATH);
const enums = parseSections(enumText, ENUM_PATH);
assert.deepEqual([...enums.sections.keys()], [...ENUM_SIGNATURES.keys()]);
for (const [name, [inputType, outputType]] of ENUM_SIGNATURES) {
    const fields = section(enums, name);
    assert.equal(one(fields, 'inputtype', ENUM_PATH), inputType, `[${name}] input type`);
    assert.equal(one(fields, 'outputtype', ENUM_PATH), outputType, `[${name}] output type`);
}

const layoutLocks = enumValues(enums, 'barrows_layout_locks');
assert.equal(layoutLocks.size, 4 * 64, 'packed layout table contains all 256 corner/rank rows');
const corridorCounts = enumValues(enums, 'barrows_layout_corridor_count');
assert.equal(corridorCounts.size, 4 * 4, 'packed corridor counts cover four corners and four exterior locks');
for (let corner = 0; corner < 4; corner++) {
    const masks = [];
    for (let rank = 0; rank < 64; rank++) {
        const key = String(corner * 64 + rank);
        assert(layoutLocks.has(key), `packed layout row ${key} exists`);
        const mask = Number(layoutLocks.get(key));
        assert(Number.isInteger(mask) && mask >= 0 && mask <= 0xffff, `packed layout row ${key} is a 16-bit mask`);
        for (const bit of [4, 8, 9, 11]) assert((mask & (1 << bit)) !== 0, `packed layout row ${key} locks central bit ${bit}`);
        masks.push(mask);
    }
    for (const bit of [0, 1, 7, 15]) {
        const key = String(corner * 16 + bit);
        assert(corridorCounts.has(key), `packed corridor count row ${key} exists`);
        const eligible = masks.filter(mask => (mask & (1 << bit)) === 0).length;
        assert.equal(Number(corridorCounts.get(key)), eligible, `corner ${corner} corridor bit ${bit} count derives from all packed layout rows`);
        assert([16, 48].includes(eligible), `corner ${corner} corridor bit ${bit} count is 16 or 48`);
    }
}

const noModelConfigs = `${enumText}\n${readText(PARAM_PATH)}`;
assert(!/\bmodel\w*\s*=|\b4623\b|\b45(?:44|45|46|47|48|49|50|51|52|53|54|55|56|57)\b/i.test(noModelConfigs), 'S00 must not add guessed puzzle model joins');

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

// VERIFIED original level joins, CANDIDATE draw weights, UNKNOWN class encoding.
const monsterLevels = new Map([
    ['barrows_rat', '43'], ['barrows_bloodworm', '52'], ['barrows_spider', '56'],
    ['barrows_giantrat', '76'], ['barrows_skeleton_unarmed', '77'],
    ['barrows_skeleton_armed', '77'], ['barrows_giantspider', '79']
]);
assert.deepEqual(enumValues(enums, 'barrows_monster_level'), monsterLevels);
for (const [name, level] of monsterLevels) assert.equal(one(section(allNpcs, name), 'vislevel', 'all.npc'), level, `${name} original combat level`);
assert.deepEqual(enumValues(enums, 'barrows_door_class_npc'), new Map([
    ['0', '^barrows_door_skeleton_npc'],
    ['1', 'barrows_bloodworm'],
    ['2', 'barrows_rat']
]));
assert.deepEqual(enumValues(enums, 'barrows_door_draw_class'), new Map(Array.from({ length: 128 }, (_, draw) => [
    String(draw), draw < 12 ? 'brother' : draw < 64 ? 'skeleton' : draw < 96 ? 'bloodworm' : 'crypt_rat'
])));
const doorConstants = new Map([
    ['barrows_door_skeleton_npc', 'barrows_skeleton_unarmed'],
    ['barrows_door_spawn_min_radius', '0'], ['barrows_door_spawn_radius', '2'],
    ['barrows_door_summon_lifetime', '1000'], ['barrows_door_summon_credit', '"owner_and_killer"'],
    ['barrows_door_class_none', '-1'], ['barrows_door_class_brother', '3'],
    ['barrows_door_class_skeleton', '0'], ['barrows_door_class_bloodworm', '1'],
    ['barrows_door_class_crypt_rat', '2']
]);
const constantText = readText('scripts/minigames/game_barrows/configs/barrows.constant');
for (const [name, expected] of doorConstants) {
    const definitions = [...constantText.matchAll(new RegExp(`^\\^${name}\\s*=\\s*(.+)$`, 'gm'))];
    assert.equal(definitions.length, 1, `one engineering constant ${name}`);
    assert.equal(definitions[0][1].trim(), expected, `${name} selected engineering policy`);
}

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
const digPattern = /~barrows_dig_dest\(enum\(npc, coord, barrows_brother_crypt_entry, (barrows_\w+)\)\);/g;
const digBrothers = [...digText.matchAll(digPattern)].map(match => match[1]);
assert.deepEqual(digBrothers, [...expectedEntryByBrother.keys()], 'all six measured Dig branches consume their brother entry join');

const stairsText = readText('scripts/ladders+stairs/scripts/stairs.rs2');
const delegatedStairs = [];
let currentStair = null;
for (const line of stairsText.split(/\r?\n/)) {
    const header = line.match(/^\[oploc1,barrows_stairs_(ahrim|dharok|guthan|karil|torag|verac)\]$/);
    if (header) currentStair = `barrows_stairs_${header[1]}`;
    else if (/^\[/.test(line)) currentStair = null;
    if (currentStair && line.trim() === '~barrows_stair_exit(loc_type);') delegatedStairs.push(currentStair);
}
assert.deepEqual(delegatedStairs, [...expectedExitByStair.keys()], 'all six stair operations delegate to the joined inverse exit');

const roomEdges = enumValues(enums, 'barrows_room_edges_by_lock');
assert.deepEqual(enumValues(enums, 'barrows_door_lock_state'), new Map([['0', 'unlocked'], ['1', 'locked']]));

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
    const lockName = one(fields, 'multivar', 'all.loc');
    assert(/^barrows_door_[a-p]$/.test(lockName), `[${name}] original lock varbit`);
    assert.deepEqual(values(fields, 'multiloc'), [`0,barrows_door_unlocked_${side}`, `1,barrows_door_locked_${side}`], `[${name}] 0 unlocked / 1 locked children`);
    const paramsForDoor = paramValues(fields, `[${name}]`);
    assert.equal(paramsForDoor.get('barrows_room_edge_lock'), String(varbitPack.byName.get(lockName)), `[${name}] lock-bit param must match multivar`);
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

// The map format gives absolute x/z in mapLocRows. Corner ladders define the
// outer room centres; the chest defines the middle row and column.
function mappedLandmark(name) {
    const rows = mappedLocs.filter(row => row.level === 0 && row.id === locPack.byName.get(name));
    assert.equal(rows.length, 1, `one mapped ${name}`);
    return rows[0];
}
const corners = ['a', 'c', 'g', 'i'].map(letter => mappedLandmark(`barrows_ladder_${letter}`));
const chest = mappedLandmark('barrows_stone_chest');
const columns = [Math.min(...corners.map(row => row.x)), chest.x, Math.max(...corners.map(row => row.x))];
const rows = [Math.max(...corners.map(row => row.z)), chest.z, Math.min(...corners.map(row => row.z))];
assert.equal(columns[1] - columns[0], columns[2] - columns[1], 'evenly spaced room columns');
assert.equal(rows[0] - rows[1], rows[1] - rows[2], 'evenly spaced room rows');

function edgeAt(placement) {
    const column = columns.reduce((best, x, index) => Math.abs(placement.x - x) < Math.abs(placement.x - columns[best]) ? index : best, 0);
    const row = rows.reduce((best, z, index) => Math.abs(placement.z - z) < Math.abs(placement.z - rows[best]) ? index : best, 0);
    const dx = placement.x - columns[column];
    const dz = placement.z - rows[row];
    // Both halves lie on the centre line (within one tile) of the other axis.
    assert(Math.min(Math.abs(dx), Math.abs(dz)) <= 1 && Math.max(Math.abs(dx), Math.abs(dz)) > 1, `map row ${placement.line}: door must lie between room centres`);
    const horizontal = Math.abs(dx) > Math.abs(dz);
    const nextColumn = column + (horizontal ? Math.sign(dx) : 0);
    const nextRow = row - (horizontal ? 0 : Math.sign(dz));
    const room = ROOM_NAMES.rows[row][column];
    if (nextColumn < 0) return `${room}>${ROOM_NAMES.west}`;
    if (nextColumn > 2) return `${room}>${ROOM_NAMES.east}`;
    if (nextRow < 0) return `${room}>${ROOM_NAMES.north}`;
    if (nextRow > 2) return `${room}>${ROOM_NAMES.south}`;
    const neighbor = ROOM_NAMES.rows[nextRow][nextColumn];
    return row * 3 + column < nextRow * 3 + nextColumn ? `${room}>${neighbor}` : `${neighbor}>${room}`;
}

const mappedEdgesByLock = new Map();
for (const placement of loopPlacements.filter(row => doorParentIds.has(row.id))) {
    const name = locPack.byId.get(placement.id);
    const fields = section(allLoc, name);
    const lockId = paramValues(fields, `[${name}]`).get('barrows_room_edge_lock');
    const edge = edgeAt(placement);
    assert(roomEdges.get(lockId)?.split('|').includes(edge), `map row ${placement.line} [${name}] lock ${lockId} does not contain map-derived edge ${edge}`);
    const edges = mappedEdgesByLock.get(lockId) ?? new Set();
    edges.add(edge);
    mappedEdgesByLock.set(lockId, edges);
}
const normalizedEnumEdges = new Map([...roomEdges].map(([lock, edges]) => {
    const list = edges.split('|');
    assert.equal(new Set(list).size, list.length, `lock ${lock}: duplicate enum edge`);
    return [lock, list.sort()];
}));
assert.deepEqual(normalizedEnumEdges, new Map([...mappedEdgesByLock].map(([lock, edges]) => [lock, [...edges].sort()])), 'all sixteen lock enums must equal the edges measured from every placed parent');
assert.equal(mappedEdgesByLock.size, 16, 'all sixteen original locks have mapped edges');
const measuredEdges = [...mappedEdgesByLock.values()].flatMap(edges => [...edges]);
assert.equal(new Set(measuredEdges).size, measuredEdges.length, 'no room edge belongs to multiple locks');
assert.equal(measuredEdges.filter(edge => !edge.includes('_outside')).length, 12, 'all twelve internal room edges');
assert.equal(measuredEdges.filter(edge => edge.includes('_outside')).length, 8, 'all eight outer openings');

assert.equal(interfacePack.byId.get(4535), 'kill_count', 'original kill_count interface id');
assert.equal(interfacePack.byId.get(4543), 'next_shape', 'original next_shape interface id');
const interfaceInventory = readText('scripts/interfaces/kill_count.if') + readText('scripts/interfaces/next_shape.if');
assert(interfaceInventory.includes('push_varbit,barrows_killed_count'), 'kill_count retains its original counter field');
assert(!/barrows_(?:puzzle_)?model|model\s*=\s*\d+/i.test(interfaceInventory), 'S00 does not add puzzle-model identities to original interfaces');
const workflow = readText('.github/workflows/content.yml');
const registrations = workflow.match(/^[ \t]*run_test tests\/barrows\/test_config\.mjs(?:\s|$)/gm) ?? [];
assert.equal(registrations.length, 1, 'the workflow must register this offline test exactly once');

console.log(`Barrows S00 config/map contract passed for ${contentRoot}`);
