#!/usr/bin/env node
/** Run from the sibling engine after a full pack. No server is started.
 * CANDIDATE repairs follow the spawn-audit rulings, not verified period history.
 * Piglet 2320 moves to the farm pen: CANDIDATE OSRS Piglet r15196637 map data.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './test_audited_spawns.mjs';

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT, '../engine');
const PACK = path.join(ENGINE, 'data/pack');
const load = async file => import(pathToFileURL(path.join(ENGINE, file)).href);
const { unzipSync } = createRequire(path.join(ENGINE, 'package.json'))('fflate');
const { default: NpcType } = await load('src/cache/config/NpcType.ts');
const { default: ObjType } = await load('src/cache/config/ObjType.ts');
NpcType.load(PACK); ObjType.load(PACK);
assert(NpcType.count > 3233, 'Full pack required');

// map square, section, level, local X, local Z, old type, repaired type, quantity.
// null means remove only that record. Piglet relocation has source and destination entries.
const TARGETS = [
    ['46_52', 'NPC', 0, 24, 51, 3031, 3231],
    ['50_50', 'NPC', 0, 59, 57, 1183, null],
    ['47_52', 'NPC', 1, 41, 61, 3033, 3233],
    ['47_52', 'NPC', 1, 48, 61, 3032, 3232],
    ['47_52', 'NPC', 1, 31, 60, 3032, 3232],
    ['47_52', 'NPC', 1, 23, 61, 3033, 3233],
    ['47_52', 'NPC', 1, 56, 56, 3033, 3233],
    ['46_52', 'NPC', 0, 6, 51, 3031, 3231],
    ['47_52', 'NPC', 1, 20, 1, 3032, 3232],
    ['47_52', 'NPC', 1, 30, 1, 3033, 3233],
    ['47_52', 'NPC', 1, 51, 2, 3033, 3233],
    ['47_52', 'NPC', 1, 43, 1, 3032, 3232],
    ['51_51', 'NPC', 0, 57, 57, 1994, null],
    ['43_49', 'NPC', 0, 59, 56, 1056, 1055],
    ['40_48', 'OBJ', 1, 33, 31, 4838, 4838, 1],
    ['44_56', 'OBJ', 0, 48, 1, 1926, 1925, 1],
    ['44_56', 'OBJ', 0, 42, 2, 1926, 1925, 1],
    ['40_60', 'NPC', 0, 34, 46, 1633, 1363],
    ['47_47', 'NPC', 0, 11, 11, 2320, null],
    ['47_51', 'NPC', 0, 11, 45, null, 2320],
    ['41_58', 'OBJ', 0, 47, 25, 461, 561, 2],
    ['41_58', 'OBJ', 0, 48, 26, 461, 561, 2],
    ['41_41', 'NPC', 0, 61, 61, 1318, null],
    ['41_41', 'NPC', 0, 11, 11, 1324, null],
    // VERIFIED note identity; UNKNOWN cause. A corpse-model/object ID mix-up is an inference.
    ['43_157', 'OBJ', 0, 32, 30, 5685, null]
];
const key = (map, section, level, x, z) => `${map}|${section}|${level} ${x} ${z}`;
const source = [];
const failures = [];
const check = (label, fn) => {
    try { fn(); } catch (error) { failures.push(`${label}: ${error.message}`); }
};
for (const file of fs.readdirSync(path.join(CONTENT, 'maps')).filter(f => f.endsWith('.jm2')).sort()) {
    const map = file.slice(1, -4);
    let section = '';
    for (const [index, line] of fs.readFileSync(path.join(CONTENT, 'maps', file), 'utf8').split(/\r?\n/).entries()) {
        const heading = /^==== (\w+) ====$/.exec(line);
        if (heading) { section = heading[1]; continue; }
        if (!['NPC', 'OBJ'].includes(section) || !line) continue;
        const match = /^(\d+) (\d+) (\d+): (\d+)(?: (\S+))?$/.exec(line);
        assert(match, `Invalid spawn row ${file}:${index + 1}: ${line}`);
        const [, level, x, z, id, qty] = match;
        const row = { map, section, level: Number(level), x: Number(x), z: Number(z), id: Number(id), qty: section === 'OBJ' ? Number(qty) : 1 };
        if (section === 'OBJ') check(`${file}:${index + 1} integer quantity`, () => {
            assert(/^\d+$/.test(qty), 'quantity must be an integer');
            assert(row.qty >= 1 && row.qty <= 255, 'quantity must fit the spawn byte');
        });
        source.push(row);
    }
}
const canonical = rows => rows.map(r => `${key(r.map, r.section, r.level, r.x, r.z)}:${r.id}:${r.qty}`).sort();
for (const [map, section, level, x, z, , id, qty = 1] of TARGETS) check(`repaired ${key(map, section, level, x, z)}`, () => {
    const actual = source.filter(r => key(r.map, r.section, r.level, r.x, r.z) === key(map, section, level, x, z));
    assert.deepEqual(canonical(actual), canonical(id === null ? [] : [{ map, section, level, x, z, id, qty }]));
});
for (const [id, x, z] of [[3031, 47, 11], [3032, 23, 58], [3033, 44, 21]]) check(`genuine Nardah type ${id}`, () => {
    const rows = source.filter(r => r.section === 'NPC' && r.id === id);
    assert.deepEqual(rows, [{ map: '53_45', section: 'NPC', level: 0, x, z, id, qty: 1 }]);
});
for (const [id, count, region] of [[1183, 5, [33, 35, 49, 52]], [1994, 54, [49, 54, 43, 47]], [1318, 13, [40, 42, 56, 58]], [1324, 4, [40, 42, 56, 58]], [2320, 1, null]]) {
    const rows = source.filter(r => r.section === 'NPC' && r.id === id);
    check(`remaining exact type ${id}`, () => assert.equal(rows.length, count));
    if (region) check(`type ${id} remains in its home region`, () => assert.equal(rows.filter(r => {
        const [mx, mz] = r.map.split('_').map(Number);
        return mx >= region[0] && mx <= region[1] && mz >= region[2] && mz <= region[3];
    }).length, count));
}
for (const [id, name, level, ops] of [[3231, 'Guard', 22, ['Attack', 'Pickpocket']], [3232, 'Guard', 22, ['Attack', 'Pickpocket']], [3233, 'Guard', 22, ['Attack', 'Pickpocket']], [1055, 'Pirate Jackie the Fruit', 0, ['Talk-to', 'Trade']], [1363, 'Moldof', 1, ['Talk-to', 'Attack']]]) check(`packed NPC ${id}`, () => {
    const npc = NpcType.get(id);
    assert.equal(npc.name, name); assert.equal(npc.vislevel, level);
    for (const op of ops) assert(npc.op.includes(op));
});
for (const [id, name] of [[1925, 'Bucket'], [561, 'Nature rune'], [4838, 'Cup of tea']]) check(`packed object ${id}`, () => {
    const obj = ObjType.get(id);
    assert.equal(obj.name, name); assert.equal(obj.certtemplate, -1); assert(obj.op.includes('Take'));
});
// Decode exactly the archive GameMap.init consumes, rather than only checking text.
const entries = unzipSync(fs.readFileSync(path.join(PACK, '.cache/maps-server.zip')));
const packed = [];
for (const [name, data] of Object.entries(entries)) {
    if (!/^[no]\d+_\d+$/.test(name)) continue;
    const section = name[0] === 'n' ? 'NPC' : 'OBJ';
    let pos = 0;
    const g1 = () => { assert(pos < data.length, `${name}: truncated spawn data`); return data[pos++]; };
    const g2 = () => (g1() << 8) | g1();
    while (pos < data.length) {
        const tile = g2(), count = g1();
        for (let i = 0; i < count; i++) packed.push({ map: name.slice(1), section, level: tile >> 12, x: (tile >> 6) & 63, z: tile & 63, id: g2(), qty: section === 'OBJ' ? g1() : 1 });
    }
}
check('runtime packed spawns equal source records', () => assert.deepEqual(canonical(packed), canonical(source)));
if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
} else console.log(`PASS spawn repair: ${TARGETS.length} audited entities, including the Kendal cave note removal, Piglet relocation, three Nardah citizens, all quantities and runtime packed data`);
