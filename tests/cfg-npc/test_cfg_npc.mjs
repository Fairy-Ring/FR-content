#!/usr/bin/env node
/** Packed server-value proof. Historical confidence is recorded in the expectation manifest. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.resolve(testDir, '../..');
const engineDir = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentDir, '../engine');
const args = process.argv.slice(2);
let packDir = path.join(engineDir, 'data/pack');
let reportFile = null;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pack' && args[i + 1]) packDir = path.resolve(args[++i]);
    else if (args[i] === '--report' && args[i + 1]) reportFile = path.resolve(args[++i]);
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const expected = JSON.parse(fs.readFileSync(path.join(testDir, 'expected.json'), 'utf8'));
const engineImport = relative => import(pathToFileURL(path.join(engineDir, relative)).href);
const NpcType = (await engineImport('src/cache/config/NpcType.ts')).default;
const ParamType = (await engineImport('src/cache/config/ParamType.ts')).default;
const { ParamHelper } = await engineImport('src/cache/config/ParamHelper.ts');
const Jagfile = (await engineImport('src/io/Jagfile.ts')).default;
// Enum, hunt and category ids are allocated when the generated packs are built, so they differ between a
// fresh clone and an incremental checkout. A row that names one of them gives the config name, not the id.
const refTypes = {
    enum: (await engineImport('src/cache/config/EnumType.ts')).default,
    hunt: (await engineImport('src/cache/config/HuntType.ts')).default,
    category: (await engineImport('src/cache/config/CategoryType.ts')).default
};
NpcType.load(packDir);
ParamType.load(packDir);
for (const type of Object.values(refTypes)) type.load(packDir);
function expectedValue(expectation) {
    if (expectation === null || typeof expectation !== 'object' || Array.isArray(expectation)) return expectation;
    const type = refTypes[expectation.ref];
    assert(type, `Unknown reference kind ${expectation.ref}`);
    const id = type.getId(expectation.name);
    assert(id >= 0, `Packed ${expectation.ref} ${expectation.name} must exist`);
    return id;
}
assert(NpcType.count > 0 && ParamType.count > 0, 'The engine server pack must be present');
assert(expected.rows.length > 0, 'The restoration manifest must not be empty');

const sha256 = data => createHash('sha256').update(data).digest('hex');
const jag = Jagfile.load(path.join(packDir, 'client/config'));
const hashes = {};
const assertions = [];
for (const name of ['npc.dat', 'npc.idx']) {
    const packet = jag.read(name);
    assert(packet, `Client NPC archive is missing ${name}`);
    hashes[name] = sha256(packet.data);
    assertions.push({ id: `client/${name}`, pass: hashes[name] === expected.clientHashes[name],
        expected: expected.clientHashes[name], actual: hashes[name] });
}

const stats = { attack: 0, defence: 1, strength: 2, hitpoints: 3, ranged: 4, magic: 5 };
function effectiveValue(npc, field) {
    if (field.startsWith('param:')) {
        const name = field.slice(6);
        const param = ParamType.getByName(name);
        assert(param, `Packed parameter ${name} must exist`);
        return param.isString()
            ? ParamHelper.getStringParam(param.id, npc, param.defaultString)
            : ParamHelper.getIntParam(param.id, npc, param.defaultInt);
    }
    if (/^patrol\d+$/.test(field)) {
        const index = Number(field.slice(6)) - 1;
        return [npc.patrolCoord[index] ?? null, npc.patrolDelay[index] ?? null];
    }
    if (Object.hasOwn(stats, field)) return npc.stats[stats[field]];
    assert(Object.hasOwn(npc, field), `Unknown NPC field ${field}`);
    return npc[field];
}

const seen = new Set();
for (const row of expected.rows) {
    const id = `npc/${row.npc}/${row.field}`;
    assert(!seen.has(id), `Duplicate restoration row ${id}`);
    seen.add(id);
    const npc = NpcType.getByName(row.npc);
    assert(npc, `Packed NPC ${row.npc} must exist`);
    const actual = effectiveValue(npc, row.field);
    const want = expectedValue(row.expected);
    const pass = JSON.stringify(actual) === JSON.stringify(want);
    assertions.push({ id, group: row.group, pass, expected: row.expected, actual });
}

const counts = {};
for (const result of assertions) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} expected=${JSON.stringify(result.expected)} actual=${JSON.stringify(result.actual)}`);
    if (result.group) {
        counts[result.group] ??= { pass: 0, fail: 0 };
        counts[result.group][result.pass ? 'pass' : 'fail']++;
    }
}
const failures = assertions.filter(row => !row.pass);
const report = { status: failures.length === 0 ? 'PASS' : 'FAIL', publishedContent: expected.publishedContent,
    inheritedReference: expected.inheritedReference, periodTruth: expected.periodTruth,
    hashes, counts, rowCount: expected.rows.length, failures: failures.length, assertions };
if (reportFile) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`cfg-npc: ${expected.rows.length} server rows, ${failures.length} failures, client NPC hashes ${JSON.stringify(hashes)}`);
process.exitCode = failures.length === 0 ? 0 : 1;
