#!/usr/bin/env node
/** Run from the sibling engine after npm run build. No world or live server. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTENT_ROOT, scanSource, scanTree, printReport } from './scan_random_tables.mjs';

// These hashes freeze the published text, tags, pages, branch order and non-table code.
// Only random bounds and numeric case labels are excluded from the hashes.
const TARGETS = [
    {
        file: 'scripts/areas/area_ardougne_east/scripts/man_east_ardougne.rs2',
        script: '[label,citizen_dialogue_eastardy]', count: 23,
        hash: '227c44f0189a1bb188bc2c710249b2792fa58f188fca1c346c7e2812e8c2c68a'
    },
    {
        file: 'scripts/areas/area_burthorpe/scripts/citizen_burthrope.rs2',
        script: '[label,citizen_burthorpe_talk]', count: 12,
        hash: 'e1b4c4ea1ec100f590bd11c0f287e3d5cadc90e7328369ccc76d26df5e8fe89a'
    }
];

// Scanner fixtures cover nested switches, grouped labels, comments, defaults,
// duplicate labels and dynamic bounds. They do not replace the packed checks.
const fixture = scanSource(`// switch_int(random(99)) { case 0: }
switch_int(random(3)) {
    case 0, 1: mes("case 99: { }");
        switch_int(random(1)) { case 0: return; }
    case 1: return;
    case default: return;
}
switch_int(random(calc(2 + 3))) { case 9: return; }
`, 'scanner-fixture');
assert.equal(fixture.length, 3);
assert.deepEqual(fixture[0].labels, ['0', '1', '1', 'default']);
assert.deepEqual(fixture[0].duplicates, ['1']);
assert.deepEqual(fixture[0].missing, [2]);
assert.equal(fixture[0].hasDefault, true);
assert.equal(fixture[1].bound, 1);
assert.equal(fixture[2].bound, null);
assert.equal(fixture[2].boundExpression, 'calc(2 + 3)');

const ENGINE_ROOT = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_ROOT, '../engine');
const PACK_DIR = path.join(ENGINE_ROOT, 'data/pack');
const load = async file => import(pathToFileURL(path.join(ENGINE_ROOT, file)).href);
const { default: ScriptProvider } = await load('src/engine/script/ScriptProvider.ts');
const { ScriptOpcode } = await load('src/engine/script/ScriptOpcode.ts');
assert(ScriptProvider.load(PACK_DIR) > 0, 'Build the sibling engine before running this test');
const dat = fs.readFileSync(path.join(PACK_DIR, 'server/script.dat'));
const idx = fs.readFileSync(path.join(PACK_DIR, 'server/script.idx'));

// Retain the raw entries too: ScriptFile.decode overwrites repeated keys.
function rawSwitches(id) {
    let start = 8;
    for (let i = 0; i < id; i++) start += idx.readInt32BE(4 + i * 4);
    const size = idx.readInt32BE(4 + id * 4);
    const bytes = dat.subarray(start, start + size);
    const trailerLength = bytes.readUInt16BE(size - 2);
    let pos = size - trailerLength - 2;
    const count = bytes.readUInt8(pos++);
    const tables = [];
    for (let i = 0; i < count; i++) {
        const entries = bytes.readUInt16BE(pos);
        pos += 2;
        const table = [];
        for (let j = 0; j < entries; j++) {
            table.push({ key: bytes.readInt32BE(pos), offset: bytes.readInt32BE(pos + 4) });
            pos += 8;
        }
        tables.push(table);
    }
    assert.equal(pos, size - 2, 'Raw switch trailer length');
    return tables;
}

const failures = [];
for (const target of TARGETS) {
    const source = fs.readFileSync(path.join(CONTENT_ROOT, target.file), 'utf8');
    const normalized = source.replace(/(switch_int\(random\()\d+/g, '$1BOUND').replace(/(\bcase\s+)\d+(\s*:)/g, '$1LABEL$2');
    assert.equal(crypto.createHash('sha256').update(normalized).digest('hex'), target.hash, `${target.file}: authored content changed`);
    const table = scanSource(source, target.file)[0];
    assert.equal(table.branches.length, target.count, `${target.file}: authored branch count`);
    const script = ScriptProvider.getByName(target.script);
    assert(script, `Missing packed ${target.script}`);
    const switches = script.opcodes.flatMap((op, pc) => op === ScriptOpcode.SWITCH ? [pc] : []);
    assert.equal(switches.length, 1, `${target.script}: expected one selector`);
    const pc = switches[0];
    assert.equal(script.opcodes[pc - 1], ScriptOpcode.RANDOM, 'Selector must use exclusive RANDOM');
    assert.equal(script.opcodes[pc - 2], ScriptOpcode.PUSH_CONSTANT_INT, 'Selector bound must be constant');
    const bound = script.intOperands[pc - 2];
    assert.equal(bound, table.bound, 'Packed/source bound mismatch: rebuild the pack');
    const packed = script.switchTables[script.intOperands[pc]];
    const raw = rawSwitches(script.id)[script.intOperands[pc]];
    const branchAt = destination => {
        const line = script.lineNumber(destination);
        return table.branches.filter(branch => line >= branch.line && line < branch.endLine).map(branch => branch.index);
    };
    const rawMap = raw.map(entry => ({ ...entry, branches: branchAt(pc + entry.offset + 1) }));
    console.log(JSON.stringify({ script: target.script, bound, rawMap }));
    const counts = Array(target.count).fill(0);
    const map = [];
    for (let roll = 0; roll < bound; roll++) {
        const offset = packed[roll];
        if (offset === undefined) {
            // In these scripts an unmatched SWITCH takes an unconditional jump
            // to RETURN. It does not select a default or fall into another case.
            assert.equal(script.opcodes[pc + 1], ScriptOpcode.BRANCH);
            const end = pc + 2 + script.intOperands[pc + 1];
            assert.equal(script.opcodes[end], ScriptOpcode.RETURN);
            map.push({ roll, branches: [], unmatched: 'RETURN' });
            failures.push(`${target.script} roll ${roll}: no branch`);
            continue;
        }
        const destination = pc + offset + 1;
        const branches = branchAt(destination);
        map.push({ roll, branches, destination, line: script.lineNumber(destination) });
        if (branches.length !== 1) failures.push(`${target.script} roll ${roll}: ${branches.length} branches`);
        else counts[branches[0]]++;
    }
    for (let branch = 0; branch < counts.length; branch++) {
        if (counts[branch] !== 1) failures.push(`${target.script} branch ${branch}: ${counts[branch]} rolls`);
    }
    if (bound !== target.count) failures.push(`${target.script}: bound ${bound}, authored branches ${target.count}`);
    if (table.duplicates.length) failures.push(`${target.script}: duplicate labels ${table.duplicates}`);
    if (table.outOfRange.length) failures.push(`${target.script}: out-of-range labels ${table.outOfRange}`);
    console.log(JSON.stringify({ script: target.script, labels: table.labels, map, branchRollCounts: counts }));
}

// All other tables are informational: an omitted case can deliberately retain
// an initialized value or suppress optional chatter. Do not repair them here.
printReport(scanTree());
if (failures.length) {
    console.error(`FAIL citizen tables:\n${failures.join('\n')}`);
    process.exitCode = 1;
} else {
    console.log('PASS citizen tables: all 35 rolls select one distinct authored branch, inherited content unchanged');
}
