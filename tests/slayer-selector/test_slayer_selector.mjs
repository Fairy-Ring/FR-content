#!/usr/bin/env node
/**
 * Offline proof against real compiled RuneScript and packed configs.
 * Run from the sibling engine:
 *   node --import tsx ../content/tests/slayer-selector/test_slayer_selector.mjs --mode ci
 *   node --import tsx ../content/tests/slayer-selector/test_slayer_selector.mjs --mode full
 *   node --import tsx ../content/tests/slayer-selector/test_slayer_selector.mjs --mode old-discriminator --base-pack <S1 full pack>
 *   node --import tsx ../content/tests/slayer-selector/test_slayer_selector.mjs --mode ci --base-pack <S1 full pack>
 *   node --import tsx ../content/tests/slayer-selector/test_slayer_selector.mjs --mode table-old-discriminator --base-pack <published S2 pack>
 *   node --import tsx ../content/tests/slayer-selector/test_slayer_selector.mjs --mode replacement [--base-pack <published full pack>]
 *   node --import tsx ../content/tests/slayer-selector/test_slayer_selector.mjs --mode priestperil [--base-pack <published full pack>]
 * Artifacts go to --artifact-dir, else SLAYER_SELECTOR_EVIDENCE_DIR, else RUNNER_TEMP or the system temporary directory.
 *
 * No server or live client is started. The adversarial DBRows are compiled in
 * an isolated temporary content/engine copy by compile_adversarial_pack.mjs.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = path.resolve(TEST_DIR, '../..');
const ENGINE_ROOT = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_ROOT, '../engine');
const PACK_DIR = path.join(ENGINE_ROOT, 'data/pack');
const SCRIPT_DIR = path.join(CONTENT_ROOT, 'scripts');
const EVIDENCE_DEFAULT = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'slayer-selector');
const ADJACENT_FIXTURE = path.join(TEST_DIR, 'fixtures/slayer_selector_adversarial.dbrow');
const COMPILE_HELPER = path.join(TEST_DIR, 'compile_adversarial_pack.mjs');
const SLAYER_CONFIG_DIR = path.join(SCRIPT_DIR, 'skill_slayer/configs');
const SOURCES = {
    taskScript: path.join(SCRIPT_DIR, 'skill_slayer/scripts/slayer_task.rs2'),
    masterScript: path.join(SCRIPT_DIR, 'skill_slayer/scripts/slayer_master.rs2'),
    recommendationScript: path.join(SCRIPT_DIR, 'skill_slayer/scripts/slayer_gem.rs2'),
    masterRows: path.join(SLAYER_CONFIG_DIR, 'slayer_master_tasks.dbrow'),
    taskRows: path.join(SLAYER_CONFIG_DIR, 'slayer_tasks.dbrow'),
    constants: path.join(SLAYER_CONFIG_DIR, 'slayer.constant'),
    questConstants: path.join(SCRIPT_DIR, 'general/configs/quest.constant'),
    taskNames: path.join(SLAYER_CONFIG_DIR, 'task_name.enum'),
    slayerRequirements: path.join(SLAYER_CONFIG_DIR, 'slayer_req.enum'),
    combatRequirements: path.join(SLAYER_CONFIG_DIR, 'combat_req.enum')
};

const MASTER_DEFS = [
    { key: 'turael', table: 'turael_task_table', npc: 'slayer_master_1', combat: 3, level: 3, slayer: 1 },
    { key: 'mazchna', table: 'mazchna_task_table', npc: 'slayer_master_2', combat: 20, level: 16, slayer: 1 },
    { key: 'vannaka', table: 'vannaka_task_table', npc: 'slayer_master_3', combat: 40, level: 32, slayer: 1 },
    { key: 'chaeldar', table: 'chaeldar_task_table', npc: 'slayer_master_4', combat: 70, level: 55, slayer: 50 },
    { key: 'duradel', table: 'duradel_task_table', npc: 'slayer_master_5', combat: 100, level: 79, slayer: 50 }
];
const HIGH_FIXTURE = { key: 'cb126_slayer99', combat: 126, level: 99, slayer: 99, currentSlayer: 99 };
const SEEDS = [1, 377, 20060502, 1113];
const DRAWS_PER_SEED = 50000;
const CI_DRAWS_PER_SEED = 1000;
// Independent VERIFIED oracle from the period threshold table (facts.md:48-75).
const SOURCED_SLAYER_THRESHOLDS = [
    ['slayer_crawlinghand', 5],
    ['slayer_cavebug', 7],
    ['slayer_cavecrawler', 10],
    ['slayer_banshee', 15],
    ['slayer_caveslime', 17],
    ['slayer_rockslug', 20],
    ['slayer_lizard', 22],
    ['slayer_cockatrice', 25],
    ['slayer_pyrefiend', 30],
    ['slayer_mogre', 32],
    ['slayer_harpiebugswarm', 33],
    ['slayer_wallbeast', 35],
    ['slayer_killerwatt', 37],
    ['slayer_basilisk', 40],
    ['slayer_feverspider', 42],
    ['slayer_infernalmage', 45],
    ['slayer_bloodveld', 50],
    ['slayer_jelly', 52],
    ['slayer_turoth', 55],
    ['slayer_mutatedzygomite', 57],
    ['slayer_aberrantspecter', 60],
    ['slayer_dustdevil', 65],
    ['slayer_kurask', 70],
    ['slayer_skeletalwyvern', 72],
    ['slayer_gargoyle', 75],
    ['slayer_nechryael', 80],
    ['slayer_abyssaldemon', 85],
    ['slayer_darkbeast', 90]
];
// Fixed row census includes D1 bears and the four B-SLAYERROLL memberships.
// New pair numbers are UNKNOWN engineering rows borrowed from named same-creature rows.
const MASTER_TABLES_FILE = path.join(TEST_DIR, 'master_tables.json');
const MASTER_TABLES = JSON.parse(fs.readFileSync(MASTER_TABLES_FILE, 'utf8'));
const FAMILY_B = 3800;
const ALPHA = 1e-6;
const LOG_BOUND = Math.log((2 * FAMILY_B) / ALPHA);
const OUT_OF_S1 = [
    'S8 replacement branch changes and death transitions; historical numeric retunes.',
];
const OWNER_PREDICATES = [
    {
        proc: 'slayer_priestperil_unlocked',
        categories: ['slayer_crawlinghand', 'slayer_banshee', 'slayer_infernalmage', 'slayer_bloodveld', 'slayer_aberrantspecter', 'slayer_gargoyle', 'slayer_nechryael', 'slayer_abyssaldemon', 'slayer_ghoul', 'slayer_werewolf', 'slayer_vampire'],
        // CANDIDATE assignment reconstruction: Drezel grants Morytania access at 61, after completion at 60.
        gate: { variable: 'priestperil', threshold: 61 }
    },
    { proc: 'slayer_horror_unlocked', categories: ['slayer_dagannoth'] },
    { proc: 'slayer_regicide_unlocked', categories: ['slayer_elf'] },
    { proc: 'slayer_deserttreasure_unlocked', categories: ['slayer_dustdevil'] },
    { proc: 'slayer_mourning2_unlocked', categories: ['slayer_darkbeast'], gate: { variable: 'mourning_quest_part2', threshold: 5 } },
    {
        proc: 'slayer_skippy_unlocked',
        categories: ['slayer_mogre'],
        // VERIFIED 377: skippy_state is bits 0-2 of this varp; CANDIDATE completion is 3.
        gate: { variable: 'rimmington_extras_var', threshold: 3 }
    }
];

function parseArgs(argv) {
    const result = { mode: 'full', artifactDir: process.env.SLAYER_SELECTOR_EVIDENCE_DIR ?? EVIDENCE_DEFAULT, basePack: null };
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--mode' && argv[i + 1]) result.mode = argv[++i];
        else if (token === '--artifact-dir' && argv[i + 1]) result.artifactDir = path.resolve(argv[++i]);
        else if (token === '--base-pack' && argv[i + 1]) result.basePack = path.resolve(argv[++i]);
        else throw new Error(`Unknown or incomplete argument: ${token}`);
    }
    assert(['full', 'ci', 'proportional', 'adversarial', 'old-discriminator', 'table-old-discriminator', 'replacement', 'priestperil'].includes(result.mode), `unsupported --mode ${result.mode}`);
    if (['old-discriminator', 'table-old-discriminator'].includes(result.mode)) assert(result.basePack, `--mode ${result.mode} requires --base-pack <directory containing server/>`);
    return result;
}

const OPTIONS = parseArgs(process.argv.slice(2));
const ACTIVE_PACK_DIR = OPTIONS.basePack ?? PACK_DIR;
const ACTIVE_DRAWS_PER_SEED = OPTIONS.mode === 'ci' ? CI_DRAWS_PER_SEED : DRAWS_PER_SEED;
const RUN_ID = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const RUN_DIR = path.join(OPTIONS.artifactDir, `run-${RUN_ID}`);
const METADATA_PATH = path.join(RUN_DIR, 'metadata.json');
fs.mkdirSync(RUN_DIR, { recursive: true });

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function digestFile(file) {
    return sha256(fs.readFileSync(file));
}

function hashTree(root) {
    const hash = crypto.createHash('sha256');
    const files = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile()) files.push(file);
            else if (entry.isSymbolicLink()) {
                hash.update(`symlink:${path.relative(root, file)}:${fs.readlinkSync(file)}\n`);
            }
        }
    }
    visit(root);
    for (const file of files) {
        hash.update(`${path.relative(root, file)}\0`);
        hash.update(fs.readFileSync(file));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function gitHead(directory) {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

function packEntries(kind) {
    const file = path.join(CONTENT_ROOT, `pack/${kind}.pack`);
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => /^\d+=/.test(line)).map(line => {
        const separator = line.indexOf('=');
        return [line.slice(separator + 1).trim(), Number(line.slice(0, separator))];
    });
}

const PACK_MAPS = new Map();
function packId(kind, name) {
    let map = PACK_MAPS.get(kind);
    if (!map) {
        map = new Map(packEntries(kind));
        PACK_MAPS.set(kind, map);
    }
    const value = map.get(name);
    assert.notEqual(value, undefined, `pack/${kind}.pack missing ${name}`);
    return value;
}

function parseConstants(file) {
    const result = new Map();
    for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('//')) continue;
        const separator = line.indexOf('=');
        assert(separator > 0, `${file}: malformed constant ${rawLine}`);
        let name = line.slice(0, separator).trim();
        if (name.startsWith('^')) name = name.slice(1);
        const value = line.slice(separator + 1).trim();
        assert(!result.has(name), `${file}: duplicate constant ${name}`);
        result.set(name, value);
    }
    return result;
}

function sourceValue(raw, constants, context) {
    const value = String(raw).trim();
    if (value.startsWith('^')) {
        const constant = value.slice(1);
        assert(constants.has(constant), `${context}: unresolved constant ${value}`);
        const resolved = constants.get(constant);
        assert(/^-?\d+$/.test(resolved), `${context}: ${value} is not an integer (${resolved})`);
        return Number(resolved);
    }
    if (/^-?\d+$/.test(value)) return Number(value);
    return value;
}

function parseDbRowFile(file) {
    const rows = new Map();
    let current = null;
    for (const [lineIndex, rawLine] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
        const line = rawLine.trim();
        if (!line || line.startsWith('//')) continue;
        if (line.startsWith('[') && line.endsWith(']')) {
            const name = line.slice(1, -1);
            assert(name && !rows.has(name), `${file}:${lineIndex + 1}: duplicate/empty DBRow ${name}`);
            current = { name, table: null, data: new Map(), file, line: lineIndex + 1 };
            rows.set(name, current);
            continue;
        }
        assert(current, `${file}:${lineIndex + 1}: property outside DBRow`);
        const separator = line.indexOf('=');
        assert(separator > 0, `${file}:${lineIndex + 1}: missing property separator`);
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key === 'table') {
            assert.equal(current.table, null, `${file}:${lineIndex + 1}: repeated table field`);
            current.table = value;
        } else if (key === 'data') {
            const comma = value.indexOf(',');
            assert(comma > 0, `${file}:${lineIndex + 1}: malformed data field ${value}`);
            const column = value.slice(0, comma).trim();
            const fieldValue = value.slice(comma + 1).trim();
            const values = current.data.get(column) ?? [];
            values.push(fieldValue);
            current.data.set(column, values);
        } else {
            throw new Error(`${file}:${lineIndex + 1}: unexpected DBRow key ${key}`);
        }
    }
    return rows;
}

function parseEnum(file, constants) {
    const values = [];
    for (const [lineIndex, rawLine] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
        const line = rawLine.trim();
        if (!line || line.startsWith('//') || !line.startsWith('val=')) continue;
        const body = line.slice(4);
        const comma = body.indexOf(',');
        assert(comma > 0, `${file}:${lineIndex + 1}: malformed enum row ${line}`);
        const key = body.slice(0, comma).trim();
        const value = body.slice(comma + 1).trim();
        values.push({ key, id: sourceValue(key, constants, `${file}:${lineIndex + 1}`), value, line: lineIndex + 1 });
    }
    return values;
}

function extractValidatorBody(text) {
    const marker = '[proc,validate_slayer_target]';
    const start = text.indexOf(marker);
    assert(start >= 0, `missing ${marker}`);
    const next = text.indexOf('\n[', start + marker.length);
    return text.slice(start, next < 0 ? text.length : next);
}

function matchingBrace(text, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return i;
    }
    throw new Error('unclosed validator switch block');
}

function parseValidatorRoutes(taskSource, constants) {
    const body = extractValidatorBody(taskSource).replace(/\/\/[^\n]*/g, '');
    const switchStart = body.indexOf('switch_int($target)');
    assert(switchStart >= 0, 'validator has no target switch; revise independent oracle instead of silently weakening it');
    const openIndex = body.indexOf('{', switchStart);
    assert(openIndex >= 0, 'validator switch has no opening brace');
    const closeIndex = matchingBrace(body, openIndex);
    const switchBody = body.slice(openIndex + 1, closeIndex);
    const headers = [...switchBody.matchAll(/^[ \t]*case\s+([\s\S]*?):[ \t]*$/gm)];
    assert(headers.length > 0, 'independent parser found no validator cases');
    const alwaysBlocked = new Set();
    const recognized = new Set();
    const questGates = new Map();
    const ownerProcByTarget = new Map();
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const nextIndex = i + 1 < headers.length ? headers[i + 1].index : switchBody.length;
        const block = switchBody.slice(header.index + header[0].length, nextIndex);
        const labels = [...header[1].matchAll(/\^([A-Za-z0-9_]+)/g)].map(match => match[1]);
        assert(labels.length > 0, `validator case had no constant labels: ${header[1]}`);
        const targetIds = labels.map(name => {
            assert(constants.has(name), `validator case references unknown constant ^${name}`);
            return Number(constants.get(name));
        });
        for (const target of targetIds) recognized.add(target);

        const questGate = block.match(/%([A-Za-z0-9_]+)\s*<\s*\^([A-Za-z0-9_]+)/);
        const ownerCall = block.match(/\breturn\s*\(\s*~([A-Za-z0-9_]+)\s*\)\s*;/);
        if (questGate) {
            const [, variable, thresholdName] = questGate;
            assert(constants.has(thresholdName), `validator quest gate references unknown ^${thresholdName}`);
            const gate = { variable, threshold: Number(constants.get(thresholdName)), thresholdName };
            for (const target of targetIds) questGates.set(target, gate);
        } else if (ownerCall) {
            for (const target of targetIds) ownerProcByTarget.set(target, ownerCall[1]);
        } else if (/\breturn\s*\(\s*false\s*\)/.test(block)) {
            for (const target of targetIds) alwaysBlocked.add(target);
        }
    }
    assert(recognized.size > 0, 'validator category cases were not parsed');
    return { alwaysBlocked, recognized, questGates, ownerProcByTarget };
}

function loadOracle() {
    for (const file of Object.values(SOURCES)) assert(fs.existsSync(file), `missing source oracle input ${file}`);
    const constants = new Map([...parseConstants(SOURCES.questConstants), ...parseConstants(SOURCES.constants)]);
    const taskNameRows = parseEnum(SOURCES.taskNames, constants);
    const taskNamesById = new Map();
    for (const row of taskNameRows) {
        const value = row.value.replace(/^\"|\"$/g, '');
        assert(value.length > 0, `empty task_name at ${row.line}`);
        taskNamesById.set(row.id, value);
    }
    const slayerReqRows = parseEnum(SOURCES.slayerRequirements, constants).map(row => ({ ...row, requirement: Number(row.value) }));
    const combatReqRows = parseEnum(SOURCES.combatRequirements, constants).map(row => ({ ...row, requirement: Number(row.value) }));
    const slayerReq = new Map(slayerReqRows.map(row => [row.id, row.requirement]));
    const combatReq = new Map(combatReqRows.map(row => [row.id, row.requirement]));
    const sourceRows = new Map([
        ...parseDbRowFile(SOURCES.masterRows),
        ...parseDbRowFile(SOURCES.taskRows)
    ]);
    const taskSource = fs.readFileSync(SOURCES.taskScript, 'utf8');
    const masterSource = fs.readFileSync(SOURCES.masterScript, 'utf8');
    const recommendationSource = fs.readFileSync(SOURCES.recommendationScript, 'utf8');
    const questNames = [...new Set([
        ...[...extractValidatorBody(taskSource).matchAll(/%([A-Za-z0-9_]+)\s*</g)].map(match => match[1]),
        ...OWNER_PREDICATES.filter(owner => owner.gate).map(owner => owner.gate.variable)
    ])];
    const questValues = Object.fromEntries(questNames.map(name => [name, 0]));
    const validatorRoutes = parseValidatorRoutes(taskSource, constants);
    const reverseConstants = new Map();
    for (const [name, rawValue] of constants) {
        if (name.startsWith('slayer_') && /^\d+$/.test(rawValue)) reverseConstants.set(Number(rawValue), name);
    }
    const masters = MASTER_DEFS.map(master => {
        const tableRow = sourceRows.get(master.table);
        assert(tableRow, `missing source master table DBRow ${master.table}`);
        assert.equal(tableRow.table, 'slayer_task_table', `${master.table} has wrong DBTable`);
        const refs = tableRow.data.get('task') ?? [];
        const rows = refs.map((name, occurrenceIndex) => {
            const child = sourceRows.get(name);
            assert(child, `${master.table} refers to missing task DBRow ${name}`);
            assert.equal(child.table, 'slayer_master_task', `${name} has wrong DBTable`);
            const rawTarget = child.data.get('task')?.[0];
            const rawWeight = child.data.get('weight')?.[0];
            const rawMin = child.data.get('min_amount')?.[0];
            const rawMax = child.data.get('max_amount')?.[0];
            assert.notEqual(rawTarget, undefined, `${name} has no task field`);
            assert.notEqual(rawWeight, undefined, `${name} has no weight field`);
            assert.notEqual(rawMin, undefined, `${name} has no min_amount field`);
            assert.notEqual(rawMax, undefined, `${name} has no max_amount field`);
            return {
                master: master.key,
                table: master.table,
                sourceName: name,
                occurrenceIndex,
                rawTarget,
                target: sourceValue(rawTarget, constants, name),
                weight: Number(rawWeight),
                min: Number(rawMin),
                max: Number(rawMax)
            };
        });
        return { ...master, rows };
    });
    assert.equal(masters.length, 5);
    return {
        constants,
        taskNamesById,
        slayerReqRows,
        combatReqRows,
        slayerReq,
        combatReq,
        sourceRows,
        taskSource,
        masterSource,
        recommendationSource,
        questNames,
        questValues,
        alwaysBlockedTargets: validatorRoutes.alwaysBlocked,
        validatorCaseTargets: validatorRoutes.recognized,
        questGates: validatorRoutes.questGates,
        ownerProcByTarget: validatorRoutes.ownerProcByTarget,
        reverseConstants,
        masters
    };
}

const ORACLE = loadOracle();
const SOURCE_HASHES = Object.fromEntries(Object.entries(SOURCES).map(([name, file]) => [name, digestFile(file)]));

const S8_PROTECTED_BASELINE = {
    commit: '8bfd772a3',
    boundaries: [
        // [proc,check_progress_task] left this list with the NPC death repair (U-NPCDEATH-1113); tests/npc-death executes its packed truth table.
        { file: 'taskScript', marker: '[queue,progress_task]', label: 'queue block through the next [declaration]', sha256: 'deebdd136885e28d8ab2f2b8413c54cfde99b5e236be3c2a5e055accc5237a43' },
        { file: 'taskScript', marker: '[proc,complete_task]', label: 'completion procedure block through EOF', sha256: '3586f3f37799c51ed52dc93101dd199cecdd3448c31228477be625352db041bf' },
        { file: 'taskScript', marker: '[proc,slayer_taskname]', label: 'task-name reader block through the next [declaration]', sha256: '64e28a6beb1849b62f4e21d287bcc23d6897154ac3935922cfe1acd5027748b8' },
        { file: 'taskScript', marker: '[proc,slayer_task_tip]', label: 'task-tip reader block through the next [declaration]', sha256: 'eabeae1f4ebf4336b27a80a23e541c2d277ae4636653a1dc82d88762da133ec0' },
        { file: 'recommendationScript', marker: '[opheld1,slayer_gem]', label: 'held-gem reader block through EOF', sha256: '2e6e567289320928f895874f78574bf527d3d33877e9eecfcc2d42b9b95e307b' }
    ]
};

function expectedValidator(target, fixture) {
    const slayerRequirement = ORACLE.slayerReq.get(target) ?? 0;
    const combatRequirement = ORACLE.combatReq.get(target) ?? 0;
    const questGate = ORACLE.questGates.get(target);
    const questValue = questGate ? (fixture.questValues?.[questGate.variable] ?? ORACLE.questValues[questGate.variable] ?? 0) : 0;
    const ownerProc = ORACLE.ownerProcByTarget.get(target);
    const owner = OWNER_PREDICATES.find(entry => entry.proc === ownerProc);
    const ownerAccepts = !ownerProc || (owner?.gate
        && (fixture.questValues?.[owner.gate.variable] ?? 0) >= owner.gate.threshold);
    return fixture.baseSlayer >= slayerRequirement
        && fixture.combat >= combatRequirement
        && !ORACLE.alwaysBlockedTargets.has(target)
        && Boolean(ownerAccepts)
        && (!questGate || questValue >= questGate.threshold);
}

function expectedRowEligibility(row, fixture) {
    return row.weight > 0 && row.min <= row.max && ORACLE.taskNamesById.has(row.target) && expectedValidator(row.target, fixture);
}

function eligibleRows(master, fixture) {
    return master.rows.filter(row => expectedRowEligibility(row, fixture));
}

function uniformCombatFixture(level) {
    const base = 10 * (2 * level + Math.floor(level / 2));
    const melee = 26 * level;
    const rangedOrMagic = 13 * Math.floor(3 * level / 2);
    return Math.floor((base + Math.max(melee, rangedOrMagic)) / 40);
}

function minimumFixture(master) {
    return {
        key: `${master.key}_minimum`,
        master: master.key,
        kind: 'restricted-minimum',
        combat: master.combat,
        level: master.level,
        baseSlayer: master.slayer,
        currentSlayer: master.slayer,
        questValues: { ...ORACLE.questValues }
    };
}

function firstNonemptyFixture(master) {
    const exact = minimumFixture(master);
    if (eligibleRows(master, exact).length > 0) return { ...exact, fallbackForEmptyMinimum: null, emptyMinimumFixture: null };

    // Keep the exact minimum as a deterministic false proof; then disclose the
    // first stronger, still-admitted equal-combat-stat fixture with eligible rows.
    for (let level = master.level; level <= 99; level++) {
        const combat = uniformCombatFixture(level);
        if (combat < master.combat) continue;
        for (let slayer = master.slayer; slayer <= 99; slayer++) {
            if (master.key === 'duradel' && slayer < 50) continue;
            const candidate = {
                key: `${master.key}_first_nonempty_cb${combat}_slayer${slayer}`,
                master: master.key,
                kind: 'first-nonempty-admitted',
                combat,
                level,
                baseSlayer: slayer,
                currentSlayer: master.key === 'duradel' ? 50 : master.slayer,
                questValues: { ...ORACLE.questValues },
                fallbackForEmptyMinimum: exact.key,
                emptyMinimumFixture: exact
            };
            if (eligibleRows(master, candidate).length > 0) return candidate;
        }
    }
    throw new Error(`${master.key}: no nonempty admitted fixture through combat 126/base Slayer 99`);
}

const FIXTURES = new Map();
for (const master of ORACLE.masters) {
    FIXTURES.set(`${master.key}:minimum`, firstNonemptyFixture(master));
    FIXTURES.set(`${master.key}:high`, {
        ...HIGH_FIXTURE,
        key: `${master.key}_${HIGH_FIXTURE.key}`,
        master: master.key,
        kind: 'combat126-slayer99',
        baseSlayer: 99,
        currentSlayer: 99,
        questValues: { ...ORACLE.questValues },
        fallbackForEmptyMinimum: null
    });
}

function fixtureRowsForCompile() {
    const blocks = [fs.readFileSync(ADJACENT_FIXTURE, 'utf8').trim()];
    const endpointCases = [];
    for (const master of ORACLE.masters) {
        for (const fixtureKey of ['minimum', 'high']) {
            const fixture = FIXTURES.get(`${master.key}:${fixtureKey}`);
            for (const row of eligibleRows(master, fixture)) {
                const suffix = `${master.key}_${fixtureKey}_${row.occurrenceIndex}`;
                const masterName = `s1_selector_endpoint_table_${suffix}`;
                const childName = `s1_selector_endpoint_task_${suffix}`;
                blocks.push([
                    `[${masterName}]`,
                    'table=slayer_task_table',
                    `data=task,${childName}`,
                    '',
                    `[${childName}]`,
                    'table=slayer_master_task',
                    `data=task,${row.rawTarget}`,
                    `data=weight,${row.weight}`,
                    `data=min_amount,${row.min}`,
                    `data=max_amount,${row.max}`
                ].join('\n'));
                endpointCases.push({
                    master: master.key,
                    fixtureKind: fixtureKey,
                    sourceName: row.sourceName,
                    occurrenceIndex: row.occurrenceIndex,
                    target: row.target,
                    weight: row.weight,
                    min: row.min,
                    max: row.max,
                    masterName,
                    childName
                });
            }
        }
    }
    return { source: `${blocks.join('\n\n')}\n`, endpointCases };
}

const GENERATED_FIXTURES = fixtureRowsForCompile();
const FIXTURE_SOURCE_PATH = path.join(RUN_DIR, 'slayer_selector_compiled_fixtures.dbrow');
fs.writeFileSync(FIXTURE_SOURCE_PATH, GENERATED_FIXTURES.source);
const FIXTURE_SOURCE_HASH = digestFile(FIXTURE_SOURCE_PATH);

function compilerSourceKey(fixtureMode = 'standard') {
    const compilerPackage = path.join(ENGINE_ROOT, 'node_modules/@lostcityrs/runescript/package.json');
    const packageVersion = fs.existsSync(compilerPackage) ? JSON.parse(fs.readFileSync(compilerPackage, 'utf8')).version : 'missing';
    const roots = [
        ['content-scripts', path.join(CONTENT_ROOT, 'scripts')],
        ['content-pack-map', path.join(CONTENT_ROOT, 'pack')],
        ['engine-pack-tools', path.join(ENGINE_ROOT, 'tools/pack')],
        ['engine-config-types', path.join(ENGINE_ROOT, 'src/cache/config')],
        ['engine-script-runtime', path.join(ENGINE_ROOT, 'src/engine/script')]
    ];
    const hashes = Object.fromEntries(roots.map(([key, directory]) => [key, hashTree(directory)]));
    const helperSha256 = digestFile(COMPILE_HELPER);
    const key = sha256(JSON.stringify({ hashes, packageVersion, fixtureSource: FIXTURE_SOURCE_HASH, helperSha256, fixtureMode }));
    return { key, hashes, packageVersion, helperSha256, fixtureMode };
}

const COMPILER_INPUTS = compilerSourceKey();

function compileFixturePack(fixtureMode = 'standard') {
    const inputs = fixtureMode === 'standard' ? COMPILER_INPUTS : compilerSourceKey(fixtureMode);
    const outputBase = path.join(OPTIONS.artifactDir, 'compiled-fixtures', inputs.key.slice(0, 20));
    const args = [
        ...process.execArgv,
        COMPILE_HELPER,
        '--content', CONTENT_ROOT,
        '--engine', ENGINE_ROOT,
        '--fixture', FIXTURE_SOURCE_PATH,
        '--output-dir', outputBase,
        '--source-key', inputs.key,
        '--fixture-mode', fixtureMode
    ];
    const child = spawnSync(process.execPath, args, { cwd: ENGINE_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    if (child.error) throw child.error;
    assert.equal(child.status, 0, `fixture compiler failed (status ${child.status}):\n${output}`);
    const jsonLine = (child.stdout ?? '').split(/\r?\n/).filter(line => line.trim().startsWith('{')).at(-1);
    assert(jsonLine, `fixture compiler did not return its pack manifest:\n${output}`);
    const result = JSON.parse(jsonLine);
    assert.equal(result.sourceKey, inputs.key);
    assert.equal(result.fixtureMode, fixtureMode);
    assert.equal(result.compiled || result.reused, true);
    return result;
}

const FIXTURE_PACK_RESULT = ['replacement', 'priestperil', 'proportional'].includes(OPTIONS.mode) ? null : compileFixturePack();
const FIXTURE_PACK_DIR = FIXTURE_PACK_RESULT?.directory ?? null;

async function importEngine(relative) {
    return import(pathToFileURL(path.join(ENGINE_ROOT, relative)).href);
}

const World = (await importEngine('src/engine/World.ts')).default;
const ScriptProvider = (await importEngine('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await importEngine('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await importEngine('src/engine/script/ScriptState.ts')).default;
const Player = (await importEngine('src/engine/entity/Player.ts')).default;
const Npc = (await importEngine('src/engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await importEngine('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await importEngine('src/engine/entity/PlayerStat.ts');
const JavaRandom = (await importEngine('src/util/JavaRandom.ts')).default;
const configTypes = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbTableType', 'DbRowType', 'EnumType']) {
    configTypes[name] = (await importEngine(`src/cache/config/${name}.ts`)).default;
}

function loadRuntime({ scripts = OPTIONS.basePack ?? PACK_DIR, rows = OPTIONS.basePack ?? PACK_DIR, configs = OPTIONS.basePack ?? PACK_DIR } = {}) {
    for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'InvType', 'ObjType', 'FontType', 'Component', 'EnumType', 'DbTableType']) {
        configTypes[name].load(configs);
    }
    configTypes.DbRowType.load(rows);
    assert(ScriptProvider.load(scripts) > 0, `ScriptProvider.load found no scripts under ${scripts}`);
    World.currentTick = 1;
}

function makePlayer() {
    const player = new Player('slayer_selector_offline', 0n, 0n);
    player.uid = 1;
    player.pid = 1;
    player.staffModLevel = 0;
    player.messages = [];
    player.packets = [];
    player.lastMovement = 0;
    player.write = packet => {
        player.packets.push(packet);
        if (typeof packet.text === 'string') player.messages.push(packet.text);
    };
    player.messageGame = message => player.messages.push(message);
    player.wrappedMessageGame = message => player.messages.push(message);
    return player;
}

const COMBAT_STATS = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS, PlayerStat.PRAYER, PlayerStat.RANGED, PlayerStat.MAGIC];
const QUEST_VAR_IDS = Object.fromEntries(ORACLE.questNames.map(name => [name, packId('varp', name)]));
const IDS = {
    inv: packId('inv', 'inv'),
    gem: packId('obj', 'slayer_gem'),
    target: packId('varp', 'slayer_target'),
    count: packId('varp', 'slayer_count'),
    masters: Object.fromEntries(MASTER_DEFS.map(master => [master.key, packId('npc', master.npc)]))
};

function applyFixture(player, fixture, { drainCombat = true } = {}) {
    for (const stat of COMBAT_STATS) {
        const base = fixture.baseCombatSkills?.[stat] ?? fixture.level;
        player.baseLevels[stat] = base;
        player.levels[stat] = drainCombat ? 1 : base;
    }
    player.baseLevels[PlayerStat.SLAYER] = fixture.baseSlayer;
    player.levels[PlayerStat.SLAYER] = fixture.currentSlayer;
    for (const [name, value] of Object.entries(fixture.questValues ?? ORACLE.questValues)) player.setVar(QUEST_VAR_IDS[name], value);
}

function makeNpc(type) {
    const npcType = configTypes.NpcType.get(type);
    assert(npcType, `NpcType ${type} is not loaded`);
    return new Npc(0, 3551, 3550, 1, 1, EntityLifeCycle.DESPAWN, 1, type, npcType.blockwalk);
}

function getScript(name) {
    const script = ScriptProvider.getByName(name);
    assert(script, `compiled packed script missing ${name}`);
    return script;
}

function runRaw(player, name, npc = null, args = []) {
    const state = ScriptRunner.init(getScript(name), player, npc, args);
    const exec = player.runScript(state, true, true);
    return { state, exec, opcount: state.opcount };
}

function runPacked(player, name, npc = null, args = []) {
    const result = runRaw(player, name, npc, args);
    assert.notEqual(result.exec, -1, `${name} was refused instead of running protected`);
    assert.equal(result.exec, ScriptState.FINISHED, `${name} did not finish (exec=${result.exec}, ops=${result.opcount})`);
    assert.equal(result.state.execution, ScriptState.FINISHED, `${name} state is not FINISHED`);
    return result;
}

function returnedInt(result, label) {
    assert(result.state.isp > 0, `${label} returned no integer`);
    return result.state.popInt();
}

function runInt(player, name, npc = null, args = []) {
    const result = runPacked(player, name, npc, args);
    return { value: returnedInt(result, name), ...result };
}

function combatLevel(player) {
    return runInt(player, '[proc,player_combat_level]').value;
}

function validatorAccepts(player, npc, target) {
    const result = runInt(player, '[proc,validate_slayer_target]', npc, [target]);
    assert(result.value === 0 || result.value === 1, `validator returned nonboolean ${result.value}`);
    return result.value === 1;
}
function tracePackedCalls(procNames, callback) {
    const names = new Set(procNames.map(name => `[proc,${name}]`));
    const calls = [];
    const originalGet = ScriptProvider.get;
    ScriptProvider.get = function (id) {
        const script = originalGet.call(this, id);
        if (script && names.has(script.name)) calls.push(script.name);
        return script;
    };
    try {
        return { result: callback(), calls };
    } finally {
        ScriptProvider.get = originalGet;
    }
}

function tracePackedReturns(procNames, callback) {
    const names = new Set(procNames.map(name => `[proc,${name}]`));
    const returns = [];
    const originalPopFrame = ScriptState.prototype.popFrame;
    ScriptState.prototype.popFrame = function () {
        const scriptName = this.script?.name;
        const value = names.has(scriptName) ? this.intStack[this.isp - 1] ?? null : null;
        originalPopFrame.call(this);
        if (names.has(scriptName)) returns.push({ script: scriptName, value });
    };
    try {
        return { result: callback(), returns };
    } finally {
        ScriptState.prototype.popFrame = originalPopFrame;
    }
}

function packedEnum(name) {
    const id = packId('enum', name);
    const value = configTypes.EnumType.get(id);
    assert(value, `packed enum ${name} (id ${id}) is missing`);
    return value;
}

function completedQuestValues() {
    const values = { ...ORACLE.questValues };
    for (const gate of ORACLE.questGates.values()) {
        values[gate.variable] = Math.max(values[gate.variable] ?? 0, gate.threshold);
    }
    for (const owner of OWNER_PREDICATES) {
        if (owner.gate) values[owner.gate.variable] = owner.gate.threshold;
    }
    return values;
}

function eligibleMaster(player, npc, masterId) {
    const result = runRaw(player, '[proc,slayer_master_eligible]', npc, [masterId]);
    driveDialogue(player, result, []);
    result.value = returnedInt(result, 'slayer_master_eligible');
    assert(result.value === 0 || result.value === 1, `master admission returned nonboolean ${result.value}`);
    return result.value === 1;
}

function traceWrites(player) {
    const events = [];
    const timeline = [];
    const inventoryWrites = [];
    const originalSetVar = player.setVar;
    const originalInvAdd = player.invAdd;
    const originalWrite = player.write;
    const originalMessageGame = player.messageGame;
    const originalWrappedMessageGame = player.wrappedMessageGame;
    player.setVar = function (id, value) {
        if (id === IDS.target) {
            const event = { kind: 'target', value };
            events.push(event);
            timeline.push(event);
        } else if (id === IDS.count) {
            const event = { kind: 'count', value };
            events.push(event);
            timeline.push(event);
        }
        return originalSetVar.call(this, id, value);
    };
    player.invAdd = function (inv, object, count) {
        inventoryWrites.push({ inv, object, count });
        if (object === IDS.gem) {
            const event = { kind: 'gem', inv, object, count };
            events.push(event);
            timeline.push(event);
        }
        return originalInvAdd.call(this, inv, object, count);
    };
    player.write = function (packet) {
        if (typeof packet.text === 'string') timeline.push({ kind: 'dialogue', text: packet.text });
        return originalWrite.call(this, packet);
    };
    player.messageGame = function (message) {
        timeline.push({ kind: 'dialogue', text: message });
        return originalMessageGame.call(this, message);
    };
    player.wrappedMessageGame = function (message) {
        timeline.push({ kind: 'dialogue', text: message });
        return originalWrappedMessageGame.call(this, message);
    };
    return {
        events,
        timeline,
        inventoryWrites,
        restore() {
            player.setVar = originalSetVar;
            player.invAdd = originalInvAdd;
            player.write = originalWrite;
            player.messageGame = originalMessageGame;
            player.wrappedMessageGame = originalWrappedMessageGame;
        }
    };
}

function withRandomStream(values, callback) {
    const original = JavaRandom.nextDouble;
    const observed = [];
    let index = 0;
    JavaRandom.nextDouble = function () {
        assert(index < values.length, `unexpected random opcode call ${index + 1}; stream has ${values.length} values`);
        const value = values[index++];
        assert(value >= 0 && value < 1, `test seam supplied invalid nextDouble value ${value}`);
        observed.push(value);
        return value;
    };
    try {
        const result = callback();
        assert.equal(index, values.length, `random opcode consumed ${index}/${values.length} forced values`);
        return { result, observed };
    } finally {
        JavaRandom.nextDouble = original;
    }
}

function inventory(player) {
    const result = player.getInventory(IDS.inv);
    assert(result, 'player inventory was not loaded');
    return result;
}

function gemCount(player) {
    return inventory(player).getItemCount(IDS.gem);
}

function taskSnapshot(player) {
    const target = player.getVar(IDS.target);
    return {
        target,
        targetName: ORACLE.taskNamesById.get(target) ?? null,
        count: player.getVar(IDS.count),
        gemCount: gemCount(player)
    };
}

function seedExistingGem(player) {
    player.invAdd(IDS.inv, IDS.gem, 1);
    assert.equal(gemCount(player), 1, 'S8 prior-state fixture must contain exactly one existing Slayer gem');
}

function sentinelTask(player, target = 123456, count = 789) {
    player.setVar(IDS.target, target);
    player.setVar(IDS.count, count);
    return { target, count };
}

function rowForPacked(rowName) {
    const id = configTypes.DbRowType.getId(rowName);
    assert(id >= 0, `packed DBRow name missing: ${rowName}`);
    const row = configTypes.DbRowType.get(id);
    assert(row, `packed DBRow id ${id} missing for ${rowName}`);
    return { id, row };
}

function tableColumn(row, name) {
    const table = configTypes.DbTableType.get(row.tableId);
    assert(table, `DbTableType ${row.tableId} missing for packed row`);
    const column = table.columnNames.indexOf(name);
    assert(column >= 0, `DbTableType ${row.tableId} has no column ${name}`);
    return column;
}

function packedValues(row, name) {
    const column = tableColumn(row, name);
    const encoded = row.columnValues[column] ?? [];
    const arity = row.types[column]?.length ?? 1;
    assert.equal(encoded.length % arity, 0, `packed ${name} column has incomplete tuple`);
    const count = encoded.length / arity;
    return Array.from({ length: count }, (_, index) => {
        const value = row.getValue(column, index);
        return Array.isArray(value) ? value[0] : value;
    });
}

function assertPackedLiveRows() {
    const tableId = configTypes.DbTableType.getId('slayer_task_table');
    const taskTableId = configTypes.DbTableType.getId('slayer_master_task');
    assert(tableId >= 0 && taskTableId >= 0, 'Slayer DBTable configs are not packed');
    const packedRowsByMaster = new Map();
    const packedChildrenByName = new Map();
    for (const master of ORACLE.masters) {
        const { row: tableRow } = rowForPacked(master.table);
        assert.equal(tableRow.tableId, tableId, `${master.table} packed table id mismatch`);
        const references = packedValues(tableRow, 'task');
        assert.equal(references.length, master.rows.length, `${master.table} packed membership length differs from source`);
        const childRows = [];
        for (let index = 0; index < master.rows.length; index++) {
            const expected = master.rows[index];
            const childId = configTypes.DbRowType.getId(expected.sourceName);
            assert(childId >= 0, `packed child row missing ${expected.sourceName}`);
            assert.equal(references[index], childId, `${master.table} order/membership differs at occurrence ${index}: expected ${expected.sourceName}`);
            const child = configTypes.DbRowType.get(childId);
            assert(child, `packed child row ${expected.sourceName} missing`);
            assert.equal(child.tableId, taskTableId, `${expected.sourceName} packed table id mismatch`);
            const target = Number(packedValues(child, 'task')[0]);
            const weight = Number(packedValues(child, 'weight')[0]);
            const min = Number(packedValues(child, 'min_amount')[0]);
            const max = Number(packedValues(child, 'max_amount')[0]);
            assert.equal(target, expected.target, `${expected.sourceName} packed category differs from source`);
            assert.equal(weight, expected.weight, `${expected.sourceName} packed weight differs from source`);
            assert.equal(min, expected.min, `${expected.sourceName} packed min differs from source`);
            assert.equal(max, expected.max, `${expected.sourceName} packed max differs from source`);
            const packed = { ...expected, packedId: childId, target, weight, min, max };
            childRows.push(packed);
            packedChildrenByName.set(expected.sourceName, packed);
        }
        packedRowsByMaster.set(master.key, { ...master, rows: childRows });
    }

    return packedRowsByMaster;
}
function turaelBatMultiplicity() {
    const { row } = rowForPacked('turael_task_table');
    const bats = configTypes.DbRowType.getId('turael_bats');
    const count = packedValues(row, 'task').filter(id => id === bats).length;
    assert.equal(count, 1, 'S3 packed Turael list must contain exactly one bat occurrence');
    return count;
}

function testMasterSnapshots() {
    const results = {};
    turaelBatMultiplicity();
    for (const [key, expected] of Object.entries(MASTER_TABLES)) {
        const master = ORACLE.masters.find(candidate => candidate.key === key);
        assert(master, `unknown fixed master snapshot ${key}`);
        const { row } = rowForPacked(master.table);
        const refs = packedValues(row, 'task');
        assert.equal(refs.length, expected.length, `${key}: fixed report membership length`);
        for (const [index, [suffix, category, weight, min, max]] of expected.entries()) {
            const name = `${key}_${suffix}`;
            const target = Number(ORACLE.constants.get(`slayer_${category}`));
            assert(Number.isInteger(target), `${name}: unresolved fixed category`);
            const { id, row: child } = rowForPacked(name);
            assert.equal(refs[index], id, `${key}: fixed report order at ${index}`);
            const actual = ['task', 'weight', 'min_amount', 'max_amount'].map(column => Number(packedValues(child, column)[0]));
            assert.deepEqual(actual, [target, weight, min, max], `${name}: packed row differs from accepted labelled report`);
            const source = master.rows[index];
            assert.deepEqual([source.sourceName, source.target, source.weight, source.min, source.max], [name, target, weight, min, max], `${name}: source row differs from accepted labelled report`);
        }
        results[key] = { rows: expected.length, numericLabel: 'UNKNOWN: keeps the Lost City value', snapshotSha256: digestFile(MASTER_TABLES_FILE) };
    }
    return results;
}

function testTuraelPredicate() {
    const player = makePlayer();
    applyFixture(player, FIXTURES.get('turael:high'));
    const categories = new Set(MASTER_TABLES.turael.map(([, category]) => Number(ORACLE.constants.get(`slayer_${category}`))));
    assert.equal(categories.has(Number(ORACLE.constants.get('slayer_bear'))), true, 'D1 must activate bears in Turael membership');
    const results = [];
    for (const target of [-1, ...Array.from({ length: 77 }, (_, i) => i)]) {
        const prior = sentinelTask(player, target, 41);
        const trace = traceWrites(player);
        let actual;
        try { actual = runInt(player, '[proc,has_turael_task]').value; }
        finally { trace.restore(); }
        assert.equal(actual, categories.has(target) ? 1 : 0, `has_turael_task must equal Turael's active list: category ${target}`);
        assert.deepEqual(trace.events, [], 'membership predicate must not write task state');
        assert.equal(player.getVar(IDS.target), prior.target);
        assert.equal(player.getVar(IDS.count), prior.count);
        results.push({ target, member: actual === 1 });
    }
    return results;
}

function drawLiveRowEndpoints(masterKey, suffix, fixture) {
    const master = ORACLE.masters.find(entry => entry.key === masterKey);
    const index = MASTER_TABLES[masterKey].findIndex(([name]) => name === suffix);
    assert(index >= 0, `${masterKey}_${suffix}: no fixed row oracle`);
    const [, category, weight, min, max] = MASTER_TABLES[masterKey][index];
    const target = Number(ORACLE.constants.get(`slayer_${category}`));
    const player = makePlayer();
    const npc = makeNpc(IDS.masters[masterKey]);
    applyFixture(player, fixture);
    assert.equal(combatLevel(player), fixture.combat, 'live-table endpoint fixture combat');
    assert.equal(runInt(player, '[proc,validate_slayer_target]', npc, [target]).value, 1, `${masterKey}_${suffix}: real validator positive control`);
    return ['min', 'max'].map(side => {
        const prior = sentinelTask(player);
        const trace = traceWrites(player);
        let random;
        try {
            const stream = forcedStreamForRow(master, fixture, `${masterKey}_${suffix}`).values;
            stream[1] = side === 'min' ? 0 : 1 - Number.EPSILON;
            random = withRandomStream(stream, () => runInt(player, '[proc,generate_slayer_task]', npc, [rowForPacked(master.table).id]));
        } finally { trace.restore(); }
        const count = side === 'min' ? min : max;
        assert.equal(random.result.value, 1, `${masterKey}_${suffix}: real master table must assign`);
        assert.deepEqual(trace.events.map(event => event.kind), ['target', 'count'], 'live-table protected write order');
        assert.equal(player.getVar(IDS.target), target, `${masterKey}_${suffix}: real master target`);
        assert.equal(player.getVar(IDS.count), count, `${masterKey}_${suffix}: inclusive ${side} endpoint`);
        assert.equal(gemCount(player), 0, 'direct generator must not grant introductory gem');
        return { master: masterKey, row: suffix, target, weight, endpoint: side, count, fixture: recordFixture(fixture), prior, randomValues: random.observed, opcount: random.result.opcount };
    });
}

function testD1Bears() {
    const master = ORACLE.masters.find(entry => entry.key === 'turael');
    const bear = Number(ORACLE.constants.get('slayer_bear'));
    const bearIndex = master.rows.findIndex(row => row.sourceName === 'turael_bears');
    const goblinIndex = master.rows.findIndex(row => row.sourceName === 'turael_goblins');
    assert(bearIndex >= 0 && goblinIndex > bearIndex, 'D1 bear must retain its authored position after bats');
    const npc = makeNpc(IDS.masters.turael);
    const boundaries = [];
    for (const [level, combat] of [[10, 12], [11, 13]]) {
        const fixture = { ...FIXTURES.get('turael:minimum'), key: `d1_bear_cb${combat}`, level, combat, baseSlayer: 1, currentSlayer: 1 };
        const player = makePlayer();
        applyFixture(player, fixture);
        assert.equal(combatLevel(player), combat, 'D1 exact bear combat boundary');
        assert.equal(validatorAccepts(player, npc, bear), combat >= 13, 'D1 bear keeps the published combat-13 gate with no extra Slayer/quest gate');
        const selectedIndex = combat >= 13 ? bearIndex : goblinIndex;
        const stream = forcedStreamForRow(master, fixture, master.rows[selectedIndex].sourceName).values;
        const prior = sentinelTask(player);
        const trace = traceWrites(player);
        let result;
        try { result = withRandomStream(stream, () => runInt(player, '[proc,generate_slayer_task]', npc, [rowForPacked(master.table).id])); }
        finally { trace.restore(); }
        assert.equal(result.result.value, 1, 'D1 real Turael list must assign');
        assert.equal(player.getVar(IDS.target), master.rows[selectedIndex].target, 'D1 bear combat gate must affect actual selection');
        assert.equal(player.getVar(IDS.count), combat >= 13 ? 10 : 15, 'D1 amount keeps the published lower endpoint');
        assert.deepEqual(trace.events.map(event => event.kind), ['target', 'count'], 'D1 protected assignment write order');
        boundaries.push({ fixture: recordFixture(fixture), prior, after: taskSnapshot(player), randomValues: result.observed });
    }
    return { boundaries, endpoints: drawLiveRowEndpoints('turael', 'bears', FIXTURES.get('turael:high')) };
}

function testErnestGate(masterKey) {
    const target = Number(ORACLE.constants.get('slayer_killerwatt'));
    assert.equal(Number(ORACLE.constants.get('haunted_complete')), 3, 'Ernest completion must remain inherited state 3');
    assert.deepEqual(ORACLE.questGates.get(target), { variable: 'haunted', thresholdName: 'haunted_complete', threshold: 3 }, 'killerwatt must use Ernest, not Haunted Mine');
    const fixture = { ...FIXTURES.get(`${masterKey}:high`), questValues: { ...ORACLE.questValues, haunted: 3 } };
    const player = makePlayer();
    const npc = makeNpc(IDS.masters[masterKey]);
    const states = [];
    for (const haunted of [0, 1, 2, 3, 4]) {
        applyFixture(player, { ...fixture, questValues: { ...fixture.questValues, haunted } });
        const prior = sentinelTask(player);
        const trace = traceWrites(player);
        let result;
        try { result = runInt(player, '[proc,validate_slayer_target]', npc, [target]); }
        finally { trace.restore(); }
        assert.equal(result.value, haunted >= 3 ? 1 : 0, `${masterKey}: killerwatt Ernest state ${haunted}`);
        assert.deepEqual(trace.events, [], 'existing Ernest validation must not write task state');
        assert.equal(player.getVar(IDS.target), prior.target);
        assert.equal(player.getVar(IDS.count), prior.count);
        states.push({ haunted, accepted: result.value === 1, opcount: result.opcount });
    }
    return { master: masterKey, historicalRule: 'UNKNOWN: keeps the Lost City value', states, endpoints: drawLiveRowEndpoints(masterKey, 'killerwatts', fixture) };
}

function chaeldarCockatriceFixture() {
    return { ...FIXTURES.get('chaeldar:minimum'), key: 'chaeldar_cb70_base25_current25', baseSlayer: 25, currentSlayer: 25 };
}

function assertChaeldarRetarget(suffix, category, weight) {
    const { row } = rowForPacked(`chaeldar_${suffix}`);
    const actual = ['task', 'weight', 'min_amount', 'max_amount'].map(column => Number(packedValues(row, column)[0]));
    const expected = [Number(ORACLE.constants.get(`slayer_${category}`)), weight, 110, 170];
    assert.deepEqual(actual, expected, `S6 chaeldar_${suffix}: corrected category, unchanged Lost City numbers`);
    return { row: suffix, actual, historicalCategory: 'CANDIDATE', historicalNumbers: 'UNKNOWN: keeps the Lost City value' };
}

function testChaeldarRetargets() {
    const mappings = [assertChaeldarRetarget('elves', 'elf', 8), assertChaeldarRetarget('cockatrice', 'cockatrice', 6)];
    const fixture = chaeldarCockatriceFixture();
    const player = makePlayer();
    const npc = makeNpc(IDS.masters.chaeldar);
    const elf = Number(ORACLE.constants.get('slayer_elf'));
    const cockatrice = Number(ORACLE.constants.get('slayer_cockatrice'));
    applyFixture(player, { ...FIXTURES.get('chaeldar:high'), questValues: completedQuestValues() });
    assert.equal(runInt(player, '[proc,slayer_regicide_unlocked]').value, 0, 'unfinished Regicide proc must stay false');
    assert.equal(runInt(player, '[proc,validate_slayer_target]', npc, [elf]).value, 0, 'retargeted elves must remain excluded by their real packed gate');
    const thresholds = [];
    for (const baseSlayer of [24, 25, 26]) {
        applyFixture(player, { ...fixture, baseSlayer, currentSlayer: 1 });
        assert.equal(combatLevel(player), 70, 'cockatrice reachability fixture is exactly CB70');
        const accepted = runInt(player, '[proc,validate_slayer_target]', npc, [cockatrice]).value;
        assert.equal(accepted, baseSlayer >= 25 ? 1 : 0, 'cockatrice uses base Slayer25, not current Slayer');
        thresholds.push({ baseSlayer, currentSlayer: 1, accepted: accepted === 1 });
    }
    return { mappings, elfGate: 'unfinished exclusion; no true mock', thresholds, endpoints: drawLiveRowEndpoints('chaeldar', 'cockatrice', fixture) };
}

function testDuradelTables() {
    const player = makePlayer();
    const npc = makeNpc(IDS.masters.duradel);
    const minimum = FIXTURES.get('duradel:minimum');
    const cases = [
        ...[[99, 73], [100, 79], [101, 83]].map(([combat, prayer]) => ({ ...minimum, key: `duradel_cb${combat}_current99`, combat, baseCombatSkills: { [PlayerStat.PRAYER]: prayer }, baseSlayer: 99, currentSlayer: 99, expected: combat >= 100, axis: 'combat only' })),
        ...[49, 50, 51].map(currentSlayer => ({ ...minimum, key: `duradel_cb100_base99_current${currentSlayer}`, baseSlayer: 99, currentSlayer, expected: currentSlayer >= 50, axis: 'current Slayer only' }))
    ];
    const boundaries = cases.map(fixture => {
        applyFixture(player, fixture);
        assert.equal(combatLevel(player), fixture.combat, `${fixture.key}: exact real combat boundary`);
        const prior = sentinelTask(player);
        const trace = traceWrites(player);
        let accepted, recommended;
        try {
            accepted = eligibleMaster(player, npc, IDS.masters.duradel);
            recommended = runInt(player, '[proc,get_best_slayer_master]').value;
        } finally { trace.restore(); }
        assert.equal(accepted, fixture.expected, `${fixture.key}: independent Duradel admission boundary`);
        assert.equal(recommended, fixture.expected ? IDS.masters.duradel : IDS.masters.chaeldar, `${fixture.key}: independent recommendation boundary`);
        assert.deepEqual(trace.events, [], 'master admission and recommendation cannot alter task state');
        assert.equal(player.getVar(IDS.target), prior.target);
        assert.equal(player.getVar(IDS.count), prior.count);
        assert.equal(gemCount(player), 0);
        return { axis: fixture.axis, fixture: recordFixture(fixture), accepted, recommended };
    });
    const dragonEndpoints = MASTER_TABLES.duradel.filter(([, category]) => category.endsWith('dragon')).flatMap(([suffix]) => drawLiveRowEndpoints('duradel', suffix, FIXTURES.get('duradel:high')));
    assert.equal(dragonEndpoints.length, 10, 'five Duradel dragon rows, both inclusive endpoints');
    return { historicalNumbers: 'UNKNOWN: retained Lost City rows and disclosed borrowed bronze row; no inferred minimum130', boundaries, dragonEndpoints };
}



function testOldTableRepairs(basePack) {
    loadRuntime({ scripts: basePack, rows: basePack, configs: basePack });
    const results = [];
    const checks = [
        ['S3 duplicate bats', turaelBatMultiplicity],
        ['S3 bear predicate', testTuraelPredicate],
        ['S6 elf mapping', () => assertChaeldarRetarget('elves', 'elf', 8)],
        ['S6 cockatrice mapping', () => assertChaeldarRetarget('cockatrice', 'cockatrice', 6)],
        ['S6 real cockatrice draw', () => drawLiveRowEndpoints('chaeldar', 'cockatrice', chaeldarCockatriceFixture())]
    ];
    for (const [id, check] of checks) {
        let error;
        try { check(); } catch (failure) { error = failure; }
        assert(error instanceof assert.AssertionError, `${id}: published pack did not fail the new product assertion`);
        results.push({ id, result: 'EXPECTED_FAILURE', message: error.message });
        console.log(`EXPECTED_FAILURE ${id}: ${error.message}`);
    }
    return results;
}


function buildActualValidatorCache(player, npc, fixture, targets, label) {
    const cache = new Map();
    for (const target of new Set(targets)) {
        const actual = validatorAccepts(player, npc, target);
        const expected = expectedValidator(target, fixture);
        assert.equal(actual, expected, `${label}: source-parsed validator expectation differs for target ${target} (${ORACLE.reverseConstants.get(target) ?? 'unresolved'})`);
        cache.set(target, actual);
    }
    return cache;
}

function assertSelectedTask(master, fixture, selectedTarget, selectedCount, acceptance) {
    assert(selectedTarget >= 0 && selectedTarget <= 75, `selected category ${selectedTarget} is outside the fixed 0..75 family`);
    const occurrences = master.rows.filter(row => row.target === selectedTarget && expectedRowEligibility(row, fixture));
    assert(occurrences.length > 0, `${master.key}/${fixture.key}: selected target is not an independently eligible member`);
    assert.equal(acceptance.get(selectedTarget), true, `${master.key}/${fixture.key}: actual packed validator rejected selected category`);
    assert(occurrences.some(row => selectedCount >= row.min && selectedCount <= row.max), `${master.key}/${fixture.key}: count ${selectedCount} is outside every matching eligible occurrence`);
}

function recordFixture(fixture) {
    return {
        key: fixture.key,
        master: fixture.master,
        kind: fixture.kind,
        combat: fixture.combat,
        uniformBaseCombatSkill: fixture.baseCombatSkills ? null : fixture.level,
        baseCombatSkills: Object.fromEntries(COMBAT_STATS.map(stat => [stat, fixture.baseCombatSkills?.[stat] ?? fixture.level])),
        currentCombatSkills: Object.fromEntries(COMBAT_STATS.map(stat => [stat, 1])),
        baseSlayer: fixture.baseSlayer,
        currentSlayer: fixture.currentSlayer,
        questValues: fixture.questValues,
        fallbackForEmptyMinimum: fixture.fallbackForEmptyMinimum,
        emptyMinimumFixture: fixture.emptyMinimumFixture ? recordFixture(fixture.emptyMinimumFixture) : null
    };
}

function testCombatAndMasterAdmission() {
    const player = makePlayer();
    const observedFixtures = [];
    for (const master of ORACLE.masters) {
        const fixture = FIXTURES.get(`${master.key}:minimum`);
        applyFixture(player, fixture);
        const actualCombat = combatLevel(player);
        assert.equal(actualCombat, fixture.combat, `${fixture.key}: compiled player_combat_level must return requested CB`);
        observedFixtures.push({ ...recordFixture(fixture), actualCombatLevel: actualCombat });
        const npc = makeNpc(IDS.masters[master.key]);
        assert.equal(eligibleMaster(player, npc, IDS.masters[master.key]), true, `${fixture.key}: minimum admitted master must accept`);

        const below = { ...fixture, level: Math.max(1, fixture.level - 1), combat: uniformCombatFixture(Math.max(1, fixture.level - 1)) };
        applyFixture(player, below);
        const belowCombat = combatLevel(player);
        assert.equal(belowCombat, below.combat, `${master.key}: lower uniform stats combat formula mismatch`);
        const expectedBelow = master.key === 'turael' || belowCombat >= master.combat && (master.key !== 'duradel' || fixture.currentSlayer >= 50);
        assert.equal(eligibleMaster(player, npc, IDS.masters[master.key]), expectedBelow, `${master.key}: master admission below combat boundary`);

        const above = { ...fixture, level: Math.min(99, fixture.level + 1), combat: uniformCombatFixture(Math.min(99, fixture.level + 1)) };
        applyFixture(player, above);
        assert.equal(combatLevel(player), above.combat, `${master.key}: upper uniform stats combat formula mismatch`);
        const expectedAbove = master.key === 'turael' || above.combat >= master.combat && (master.key !== 'duradel' || fixture.currentSlayer >= 50);
        assert.equal(eligibleMaster(player, npc, IDS.masters[master.key]), expectedAbove, `${master.key}: master admission above combat boundary`);
    }

    const duradelNpc = makeNpc(IDS.masters.duradel);
    const cb100 = { key: 'duradel_cb100_current_slayer_probe', combat: 100, level: 79, baseSlayer: 1, currentSlayer: 49, questValues: { ...ORACLE.questValues } };
    applyFixture(player, cb100);
    assert.equal(combatLevel(player), 100, 'Duradel current-Slayer probe must be CB100');
    assert.equal(eligibleMaster(player, duradelNpc, IDS.masters.duradel), false, 'Duradel admission must use current Slayer 49 even with base Slayer 1');
    player.levels[PlayerStat.SLAYER] = 50;
    assert.equal(eligibleMaster(player, duradelNpc, IDS.masters.duradel), true, 'Duradel admission must use current Slayer 50 even with base Slayer 1');
    player.levels[PlayerStat.SLAYER] = 49;
    assert.equal(runInt(player, '[proc,get_best_slayer_master]').value, IDS.masters.chaeldar, 'recommendation must use current, not base, Slayer');
    player.levels[PlayerStat.SLAYER] = 50;
    assert.equal(runInt(player, '[proc,get_best_slayer_master]').value, IDS.masters.duradel, 'recommendation must use current Slayer 50 for Duradel');

    return {
        fixtures: observedFixtures,
        duradelCurrentVsBaseSlayer: {
            combat: 100,
            baseSlayer: 1,
            currentSlayerBoundary: [49, 50],
            admittedAtCurrent50: true,
            recommendedAtCurrent50: true,
            admittedAtCurrent49: false,
            recommendedBelowCurrent50: false
        }
    };
}

function testThresholds() {
    assert.equal(SOURCED_SLAYER_THRESHOLDS.length, 28, 'fixed VERIFIED oracle must cover all 28 sourced Slayer thresholds');
    const sourceThresholds = new Map(ORACLE.slayerReqRows.map(row => [ORACLE.reverseConstants.get(row.id), row.requirement]));
    assert.equal(sourceThresholds.size, SOURCED_SLAYER_THRESHOLDS.length, 'source slayer_req category set differs from the independent VERIFIED threshold oracle');
    for (const [category, requirement] of SOURCED_SLAYER_THRESHOLDS) {
        assert.equal(sourceThresholds.get(category), requirement, `${category}: source slayer_req differs from the independent VERIFIED threshold`);
    }
    const player = makePlayer();
    const npc = makeNpc(IDS.masters.turael);
    const packedRequirements = packedEnum('slayer_req');
    const completeQuests = completedQuestValues();
    for (const gate of ORACLE.questGates.values()) {
        assert.equal(completeQuests[gate.variable], gate.threshold, `threshold fixture must complete ${gate.thresholdName}`);
    }
    const targets = [];
    const observations = [];
    for (const [category, requirement] of SOURCED_SLAYER_THRESHOLDS) {
        const target = Number(ORACLE.constants.get(category));
        assert(Number.isInteger(requirement) && requirement >= 0, `sourced threshold for ${category} is not a nonnegative integer`);
        assert.equal(ORACLE.slayerReq.get(target), requirement, `${category}: source threshold differs from the independent VERIFIED oracle`);
        assert.equal(packedRequirements.values.get(target), requirement, `${category}: packed slayer_req enum differs from the independent VERIFIED threshold`);
        const ownerProc = ORACLE.ownerProcByTarget.get(target);
        for (const baseSlayer of [...new Set([Math.max(0, requirement - 1), requirement, requirement + 1])]) {
            for (const currentSlayer of [1, 99]) {
                const fixture = {
                    key: `slayer_req_${category}_base${baseSlayer}_current${currentSlayer}`,
                    combat: 126,
                    level: 99,
                    baseSlayer,
                    currentSlayer,
                    questValues: completeQuests
                };
                applyFixture(player, fixture);
                assert.equal(combatLevel(player), 126, `${fixture.key}: combat level must be independent of current skill drain`);
                const traced = ownerProc
                    ? tracePackedCalls([ownerProc], () => validatorAccepts(player, npc, target))
                    : { result: validatorAccepts(player, npc, target), calls: [] };
                const expected = expectedValidator(target, fixture);
                assert.equal(traced.result, expected, `${fixture.key}: packed validator must use base Slayer threshold ${requirement}`);
                if (ownerProc) {
                    const expectedCalls = baseSlayer >= requirement ? [`[proc,${ownerProc}]`] : [];
                    assert.deepEqual(traced.calls, expectedCalls, `${fixture.key}: packed threshold must run before its owner gate`);
                }
                targets.push(target);
                observations.push({
                    target,
                    targetName: ORACLE.taskNamesById.get(target) ?? null,
                    requirement,
                    packedRequirement: packedRequirements.values.get(target),
                    baseSlayer,
                    currentSlayer,
                    ownerProc: ownerProc ?? null,
                    ownerGateCalled: traced.calls.length > 0,
                    expected,
                    actual: traced.result
                });
            }
        }
    }
    const zygomite = Number(ORACLE.constants.get('slayer_mutatedzygomite'));
    const lostCityGate = ORACLE.questGates.get(zygomite);
    assert.equal(lostCityGate?.variable, 'zanaris', 'zygomite threshold fixture must include completed Lost City');
    assert.equal(completeQuests.zanaris, Number(ORACLE.constants.get('zanaris_complete')), 'zygomite Lost City setup must be complete');
    assert.equal(completeQuests.haunted, Number(ORACLE.constants.get('haunted_complete')), 'Ernest setup must be complete');
    assert.equal(completeQuests.legendsquest, Number(ORACLE.constants.get('legends_complete')), 'Legends setup must be complete');
    return { rows: SOURCED_SLAYER_THRESHOLDS.length, observations, testedTargets: [...new Set(targets)].length, questSetup: completeQuests };
}

function testHarpieThreshold() {
    const target = Number(ORACLE.constants.get('slayer_harpiebugswarm'));
    assert.equal(ORACLE.slayerReq.get(target), 33, 'source oracle harpie threshold must be 33');
    assert.equal(packedEnum('slayer_req').values.get(target), 33, 'S2 harpie acceptance: packed slayer_req enum must contain 33; published S1 pack has no harpie key');
    const player = makePlayer();
    const npc = makeNpc(IDS.masters.turael);
    const questValues = completedQuestValues();
    const cases = [
        { key: 'cb45_base32', combat: 45, level: 36, baseSlayer: 32, currentSlayer: 99, expected: false },
        { key: 'cb45_base33', combat: 45, level: 36, baseSlayer: 33, currentSlayer: 1, expected: true },
        { key: 'cb40_base32', combat: 40, level: 32, baseSlayer: 32, currentSlayer: 99, expected: false },
        { key: 'cb40_base33', combat: 40, level: 32, baseSlayer: 33, currentSlayer: 1, expected: false }
    ];
    const observations = [];
    for (const entry of cases) {
        const fixture = { ...entry, questValues };
        applyFixture(player, fixture);
        assert.equal(combatLevel(player), entry.combat, `${entry.key}: harpie combat fixture mismatch`);
        const actual = validatorAccepts(player, npc, target);
        assert.equal(actual, entry.expected, `${entry.key}: harpie discriminator mismatch`);
        observations.push({ key: entry.key, combat: entry.combat, baseSlayer: entry.baseSlayer, currentSlayer: entry.currentSlayer, expected: entry.expected, actual });
    }
    return { target, requirement: 33, observations };
}

function testCurrentSlayerDoesNotGateAssignment() {
    const target = Number(ORACLE.constants.get('slayer_cockatrice'));
    assert.equal(ORACLE.slayerReq.get(target), 25, 'cockatrice must retain its sourced base-Slayer requirement');
    const player = makePlayer();
    const npc = makeNpc(IDS.masters.turael);
    const observations = [];
    for (const entry of [
        { baseSlayer: 24, currentSlayer: 99, expected: false },
        { baseSlayer: 25, currentSlayer: 1, expected: true },
        { baseSlayer: 25, currentSlayer: 99, expected: true },
        { baseSlayer: 26, currentSlayer: 1, expected: true }
    ]) {
        const fixture = { ...entry, key: `cockatrice_base${entry.baseSlayer}_current${entry.currentSlayer}`, combat: 126, level: 99, questValues: completedQuestValues() };
        applyFixture(player, fixture);
        const actual = validatorAccepts(player, npc, target);
        assert.equal(actual, entry.expected, `${fixture.key}: assignment must use base Slayer, independent of current drain/boost`);
        observations.push({ baseSlayer: entry.baseSlayer, currentSlayer: entry.currentSlayer, expected: entry.expected, actual });
    }
    return { target, requirement: 25, observations };
}

function extractBoundedSourceBlock(source, marker) {
    const start = source.indexOf(marker);
    assert(start >= 0, `missing source boundary ${marker}`);
    const next = source.indexOf('\n[', start + marker.length);
    return source.slice(start, next < 0 ? source.length : next);
}

function extractProcSource(source, procName) {
    return extractBoundedSourceBlock(source, `[proc,${procName}]`);
}

function testOwnerPredicateDispatch() {
    const expectedRoutes = new Map();
    for (const owner of OWNER_PREDICATES) {
        for (const category of owner.categories) {
            const target = Number(ORACLE.constants.get(category));
            assert(Number.isInteger(target), `owner route references missing category ^${category}`);
            assert(!expectedRoutes.has(target), `category ^${category} has multiple owner predicates`);
            expectedRoutes.set(target, owner.proc);
        }
        if (!owner.gate) {
            const body = extractProcSource(ORACLE.taskSource, owner.proc).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
            assert.equal(body, `[proc,${owner.proc}]()(boolean)return(false);`, `${owner.proc} must remain an unfinished false body`);
        }
    }
    assert.equal(ORACLE.ownerProcByTarget.size, expectedRoutes.size, 'validator source must route exactly the six planned owner contracts');
    for (const [target, proc] of expectedRoutes) {
        assert.equal(ORACLE.ownerProcByTarget.get(target), proc, `${ORACLE.reverseConstants.get(target)} must route to ${proc}`);
    }

    const fixture = { key: 'owner_gates_cb126_slayer99', combat: 126, level: 99, baseSlayer: 99, currentSlayer: 1, questValues: completedQuestValues() };
    const player = makePlayer();
    applyFixture(player, fixture);
    const npc = makeNpc(IDS.masters.turael);
    const results = [];
    for (const owner of OWNER_PREDICATES) {
        const direct = runInt(player, `[proc,${owner.proc}]`, npc);
        assert.equal(direct.value, owner.gate ? 1 : 0, `${owner.proc}: compiled predicate must match its completed-state contract`);
        for (const category of owner.categories) {
            const target = Number(ORACLE.constants.get(category));
            const traced = tracePackedCalls([owner.proc], () => validatorAccepts(player, npc, target));
            assert.equal(traced.result, Boolean(owner.gate), `${category}: owner gate must match its completed-state contract`);
            assert.deepEqual(traced.calls, [`[proc,${owner.proc}]`], `${category}: packed validator did not dispatch to ${owner.proc}`);
            results.push({ category, target, ownerProc: owner.proc, predicateResult: direct.value, validatorResult: traced.result, packedCalls: traced.calls });
        }
    }
    return { fixture, routes: results };
}

function testPriestperilAccess() {
    const owner = OWNER_PREDICATES.find(entry => entry.proc === 'slayer_priestperil_unlocked');
    assert.equal(Number(ORACLE.constants.get('priestperil_complete')), 60, 'quest completion is not the Morytania access grant');
    assert.equal(owner.categories.length, 11, 'Priest in Peril must retain all eleven routed categories');
    const targets = new Set(owner.categories.map(category => Number(ORACLE.constants.get(category))));
    const player = makePlayer();
    const validatorNpc = makeNpc(IDS.masters.turael);
    const stages = [];
    // Every pre-access stage rejects every category, including completed-but-not-admitted stage 60.
    for (let stage = 0; stage <= 61; stage++) {
        const fixture = {
            key: `priestperil_${stage}`, combat: 126, level: 99, baseSlayer: 99, currentSlayer: 99,
            questValues: { ...completedQuestValues(), priestperil: stage }
        };
        applyFixture(player, fixture);
        const expected = stage === 61;
        assert.equal(runInt(player, `[proc,${owner.proc}]`, validatorNpc).value, Number(expected), `Priest in Peril stage ${stage}: access predicate`);
        const categories = owner.categories.map(category => {
            const target = Number(ORACLE.constants.get(category));
            assert.equal(validatorAccepts(player, validatorNpc, target), expected, `${category}: stage ${stage} must ${expected ? 'admit' : 'reject'} the category`);
            return { category, target, accepted: expected };
        });
        assert.equal(player.getVar(QUEST_VAR_IDS.priestperil), stage, 'eligibility must not change quest state');
        stages.push({ stage, accepted: expected, categories });
    }

    const assignments = [];
    for (const target of targets) {
        const master = ORACLE.masters.find(entry => entry.rows.some(row => row.target === target));
        assert(master, `Priest in Peril target ${target} needs a real master row`);
        const index = master.rows.findIndex(row => row.target === target);
        const npc = makeNpc(IDS.masters[master.key]);
        for (const stage of [60, 61]) {
            const fixture = {
                key: `${master.key}_priestperil_${stage}`, combat: 126, level: 99, baseSlayer: 99, currentSlayer: 99,
                questValues: { ...completedQuestValues(), priestperil: stage }
            };
            applyFixture(player, fixture);
            assert.equal(combatLevel(player), 126, 'Priest in Peril assignment fixture combat');
            const fallback = master.rows.findIndex(row => !targets.has(row.target) && expectedRowEligibility(row, fixture));
            assert(fallback >= 0, `${master.key}: below-gate control needs an eligible non-Priest-in-Peril row`);
            const selected = stage === 61 ? index : fallback;
            const stream = forcedStreamForRow(master, fixture, master.rows[selected].sourceName).values;
            const trace = traceWrites(player);
            let draw;
            try {
                draw = withRandomStream(stream, () => runInt(player, '[proc,generate_slayer_task]', npc, [rowForPacked(master.table).id]));
            } finally {
                trace.restore();
            }
            assert.equal(draw.result.value, 1, `${master.key}: real table must assign at stage ${stage}`);
            assert.equal(player.getVar(IDS.target), master.rows[selected].target, `${master.key}: Priest in Peril gate must affect the real draw`);
            assert.equal(player.getVar(IDS.count), master.rows[selected].min, 'real assignment must retain its amount bound');
            assert.deepEqual(trace.events, [{ kind: 'target', value: master.rows[selected].target }, { kind: 'count', value: master.rows[selected].min }], 'only the permitted task may be written');
            assert.equal(player.getVar(QUEST_VAR_IDS.priestperil), stage, 'assignment must not change quest state');
            assignments.push({ target, master: master.key, stage, after: taskSnapshot(player), randomValues: draw.observed });
        }
    }
    return { stageVariable: 'priestperil', completion: 60, access: 61, stages, assignments };
}

function testSkippyAccess() {
    const owner = OWNER_PREDICATES.find(entry => entry.proc === 'slayer_skippy_unlocked');
    const target = Number(ORACLE.constants.get('slayer_mogre'));
    const masters = ORACLE.masters.filter(master => master.rows.some(row => row.target === target));
    assert(masters.length > 0, 'mogres need a real master row');
    const player = makePlayer();
    const assignments = [];
    for (let stage = 0; stage <= owner.gate.threshold; stage++) {
        const expected = stage === owner.gate.threshold;
        for (const master of masters) {
            const fixture = {
                key: `${master.key}_skippy_${stage}`, combat: 126, level: 99, baseSlayer: 99, currentSlayer: 99,
                questValues: { ...completedQuestValues(), [owner.gate.variable]: stage }
            };
            applyFixture(player, fixture);
            const npc = makeNpc(IDS.masters[master.key]);
            assert.equal(runInt(player, `[proc,${owner.proc}]`, npc).value, Number(expected), `Skippy stage ${stage}: access predicate`);
            assert.equal(validatorAccepts(player, npc, target), expected, `Skippy stage ${stage}: mogre category access`);
            const index = master.rows.findIndex(row => row.target === target);
            const fallback = master.rows.findIndex(row => row.target !== target && expectedRowEligibility(row, fixture));
            assert(fallback >= 0, `${master.key}: below-gate control needs an eligible non-mogre row`);
            const selected = expected ? index : fallback;
            const stream = forcedStreamForRow(master, fixture, master.rows[selected].sourceName).values;
            const trace = traceWrites(player);
            let draw;
            try {
                draw = withRandomStream(stream, () => runInt(player, '[proc,generate_slayer_task]', npc, [rowForPacked(master.table).id]));
            } finally {
                trace.restore();
            }
            assert.equal(draw.result.value, 1, `${master.key}: real table must assign at Skippy stage ${stage}`);
            assert.equal(player.getVar(IDS.target), master.rows[selected].target, `${master.key}: Skippy gate must affect the real draw`);
            assert.equal(player.getVar(IDS.count), master.rows[selected].min, 'real assignment must retain its amount bound');
            assert.deepEqual(trace.events, [{ kind: 'target', value: master.rows[selected].target }, { kind: 'count', value: master.rows[selected].min }], 'only the permitted task may be written');
            assert.equal(player.getVar(QUEST_VAR_IDS[owner.gate.variable]), stage, 'assignment must not change Skippy state');
            assignments.push({ master: master.key, stage, mogresAccepted: expected, after: taskSnapshot(player), randomValues: draw.observed });
        }
    }
    return { stageVariable: owner.gate.variable, completion: owner.gate.threshold, assignments };
}

function testDispatchAndOneShotOrder(packedRows) {
    const results = [];
    for (const master of ORACLE.masters) {
        for (const fixtureKind of ['minimum', 'high']) {
            const fixture = FIXTURES.get(`${master.key}:${fixtureKind}`);
            const player = makePlayer();
            applyFixture(player, fixture);
            const actualCombat = combatLevel(player);
            assert.equal(actualCombat, fixture.combat, `${fixture.key}: actual CB fixture mismatch`);
            const npc = makeNpc(IDS.masters[master.key]);
            const expectedRows = packedRows.get(master.key).rows.filter(row => expectedRowEligibility(row, fixture));
            const trace = traceWrites(player);
            JavaRandom.setSeed(1);
            const result = runInt(player, '[proc,slayer_new_target]', npc);
            trace.restore();
            if (expectedRows.length === 0) {
                assert.equal(result.value, 0, `${fixture.key}: empty eligible set must return false`);
                assert.deepEqual(trace.events, [], `${fixture.key}: false dispatch wrote target/count`);
                results.push({ fixture: recordFixture(fixture), expectedEligible: 0, success: false, writes: trace.events });
                continue;
            }
            assert.equal(result.value, 1, `${fixture.key}: five-master dispatch should return true for nonempty fixture`);
            const target = player.getVar(IDS.target);
            const count = player.getVar(IDS.count);
            const acceptance = buildActualValidatorCache(player, npc, fixture, expectedRows.map(row => row.target), fixture.key);
            assertSelectedTask(packedRows.get(master.key), fixture, target, count, acceptance);
            assert.deepEqual(trace.events.map(event => event.kind), ['target', 'count'], `${fixture.key}: selector must write target then count`);
            assert.equal(gemCount(player), 0, `${fixture.key}: selector dispatch must not grant the teaching gem`);
            results.push({ fixture: recordFixture(fixture), expectedEligible: expectedRows.length, success: true, target, count, opcount: result.opcount, writes: trace.events });
        }
    }

    const nonMasterEntry = packEntries('npc').find(([name]) => !MASTER_DEFS.some(master => master.npc === name) && configTypes.NpcType.get(packId('npc', name)));
    assert(nonMasterEntry, 'no loaded nonmaster NPC found in npc.pack');
    const [nonMasterName, nonMasterId] = nonMasterEntry;
    const fixture = FIXTURES.get('turael:high');
    const player = makePlayer();
    applyFixture(player, fixture);
    const trace = traceWrites(player);
    JavaRandom.setSeed(1);
    const result = runInt(player, '[proc,slayer_new_target]', makeNpc(nonMasterId));
    trace.restore();
    assert.equal(result.value, 0, `nonmaster ${nonMasterName} dispatch must return false`);
    assert.deepEqual(trace.events, [], 'nonmaster dispatch wrote target/count');
    assert.equal(gemCount(player), 0, 'nonmaster dispatch granted gem');
    results.push({ nonMasterName, nonMasterId, success: false, writes: trace.events });
    return results;
}

function dialogueText(player) {
    return [...player.messages, ...player.packets.map(packet => packet.text ?? '')].join(' ').replace(/\s+/g, ' ').trim();
}

function startDialogue(player, npc, name) {
    const state = ScriptRunner.init(getScript(name), player, npc);
    const exec = player.runScript(state, true, true);
    assert.notEqual(exec, -1, `${name} protected dialogue start was refused`);
    assert.notEqual(exec, ScriptState.ABORTED, `${name} aborted at start`);
    return { state, exec };
}

function driveDialogue(player, result, choices) {
    let pauses = 0;
    while (result.exec === ScriptState.PAUSEBUTTON && pauses++ < 300) {
        const menu = result.state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
        if (menu) {
            assert(choices.length > 0, `unanswered packed menu ${result.state.script.name}`);
            player.lastCom = packId('interface', `multi${menu[1]}:com_${choices.shift()}`);
        }
        result.exec = player.runScript(result.state, true, true);
        assert.notEqual(result.exec, -1, `${result.state.script.name} protected dialogue resume was refused`);
        assert.notEqual(result.exec, ScriptState.ABORTED, `${result.state.script.name} aborted while resuming`);
    }
    assert.equal(result.exec, ScriptState.FINISHED, `dialogue did not finish (exec=${result.exec}, script=${result.state.script.name})`);
    assert.equal(choices.length, 0, `dialogue did not consume requested choices: ${choices}`);
    return result;
}

function runTrackedDialogue(player, npc, scriptName, choices, forcedRandomValues, trackedProcedures = []) {
    const trace = traceWrites(player);
    const requestedChoices = [...choices];
    let tracked;
    try {
        tracked = tracePackedCalls(trackedProcedures, () => withRandomStream(forcedRandomValues, () => {
            const result = startDialogue(player, npc, scriptName);
            const driven = driveDialogue(player, result, [...requestedChoices]);
            return { exec: driven.exec, opcount: driven.state.opcount };
        }));
    } finally {
        trace.restore();
    }
    return {
        choices: requestedChoices,
        pages: trace.timeline.filter(event => event.kind === 'dialogue').map(event => event.text),
        timeline: trace.timeline,
        taskWrites: trace.events,
        inventoryWrites: trace.inventoryWrites,
        forcedRandomValues: tracked.result.observed,
        dispatchCalls: tracked.calls,
        execution: tracked.result.result
    };
}

function underqualifiedChaeldarFixture() {
    // Six non-prayer combat stats at 55 and Prayer at 52 produce CB69; current
    // stats are independently drained, while both Slayer bases stay at 50.
    const player = makePlayer();
    const fixture = {
        key: 'chaeldar_cb69_base_current_slayer50',
        combat: 69,
        level: 55,
        baseCombatSkills: { [PlayerStat.PRAYER]: 52 },
        baseSlayer: 50,
        currentSlayer: 50,
        questValues: { ...ORACLE.questValues }
    };
    applyFixture(player, fixture);
    assert.equal(combatLevel(player), 69, 'underqualified teaching fixture must be exactly CB69');
    return { player, fixture };
}

function testCurrentTeachingAdmission() {
    const { player, fixture } = underqualifiedChaeldarFixture();
    const npc = makeNpc(IDS.masters.chaeldar);
    assert.equal(eligibleMaster(player, npc, IDS.masters.chaeldar), false, 'Chaeldar must reject CB69 before first teaching');
    player.messages.length = 0;
    player.packets.length = 0;
    const prior = sentinelTask(player, 0, 789);
    const trace = traceWrites(player);
    const random = withRandomStream([], () => {
        const result = startDialogue(player, npc, '[opnpc1,_slayer_master]');
        return driveDialogue(player, result, [1, 2, 1]);
    });
    trace.restore();
    assert.deepEqual(trace.events, [], 'underqualified first teaching wrote task or gem');
    assert.equal(player.getVar(IDS.target), prior.target, 'underqualified teaching changed prior target');
    assert.equal(player.getVar(IDS.count), prior.count, 'underqualified teaching changed prior count');
    assert.equal(gemCount(player), 0, 'underqualified teaching granted a Slayer gem');
    assert.match(dialogueText(player), /not strong enough to be taught by me/i, 'teaching admission refusal line missing');
    assert.doesNotMatch(dialogueText(player), /we.ll start you off hunting|your new task is to kill/i, 'underqualified teaching displayed assignment success');
    return { fixture: recordFixture(fixture), randomValues: random.observed, writes: trace.events, messages: player.messages, packets: player.packets.length };
}
function testCurrentTeachingSuccess() {
    const master = ORACLE.masters.find(entry => entry.key === 'turael');
    const fixture = FIXTURES.get('turael:minimum');
    const player = makePlayer();
    applyFixture(player, fixture);
    assert.equal(combatLevel(player), fixture.combat, `${fixture.key}: teaching fixture combat mismatch`);
    const npc = makeNpc(IDS.masters.turael);
    assert.equal(eligibleMaster(player, npc, IDS.masters.turael), true, 'Turael should admit first teaching fixture');
    const forced = forcedStreamForRow(master, fixture);
    const acceptance = buildActualValidatorCache(player, npc, fixture, [forced.row.target], `${fixture.key}:teaching`);
    sentinelTask(player, 0, 0);
    const trace = traceWrites(player);
    JavaRandom.setSeed(1);
    const stream = withRandomStream(forced.values, () => {
        const result = startDialogue(player, npc, '[opnpc1,_slayer_master]');
        return driveDialogue(player, result, [1, 2, 1, 2]);
    });
    trace.restore();
    assert.equal(player.getVar(IDS.target), forced.row.target, 'first teaching selected a different row than the forced first eligible occurrence');
    assert(player.getVar(IDS.count) >= forced.row.min && player.getVar(IDS.count) <= forced.row.max, 'first teaching count is outside the selected row');
    assert.equal(acceptance.get(player.getVar(IDS.target)), true, 'teaching task was rejected by the packed validator');
    assert.equal(gemCount(player), 1, 'successful first teaching must grant exactly one Slayer gem');
    assert.deepEqual(trace.events.map(event => event.kind), ['target', 'count', 'gem'], 'first teaching must write target, count, then gem');
    const targetIndex = trace.timeline.findIndex(event => event.kind === 'target');
    const countIndex = trace.timeline.findIndex(event => event.kind === 'count');
    const gemIndex = trace.timeline.findIndex(event => event.kind === 'gem');
    assert.equal(countIndex, targetIndex + 1, 'dialogue or another write occurred between target and count');
    assert.equal(gemIndex, countIndex + 1, 'dialogue or another write occurred between count and gem');
    const successLineIndex = trace.timeline.findIndex(event => event.kind === 'dialogue' && /We'll start you off hunting/i.test(event.text));
    assert(successLineIndex > gemIndex, 'assignment success sentence must follow target, count and gem');
    assert.match(dialogueText(player), /we.ll start you off hunting/i, 'successful first teaching assignment line missing');
    assert.match(dialogueText(player), /enchanted gem/i, 'successful first teaching gem explanation missing');
    return { fixture: recordFixture(fixture), selectedSourceRow: forced.row.sourceName, target: player.getVar(IDS.target), count: player.getVar(IDS.count), forcedRandomValues: stream.observed, writes: trace.events, timeline: trace.timeline, gemCount: gemCount(player) };
}

function testS8ProtectedReaders() {
    const files = {
        taskScript: ORACLE.taskSource,
        recommendationScript: ORACLE.recommendationSource
    };
    const fingerprints = S8_PROTECTED_BASELINE.boundaries.map(boundary => {
        const actual = sha256(extractBoundedSourceBlock(files[boundary.file], boundary.marker));
        assert.equal(actual, boundary.sha256, `${boundary.marker} ${boundary.label} changed from pinned baseline ${S8_PROTECTED_BASELINE.commit}`);
        return { ...boundary, actualSha256: actual };
    });
    return { baselineCommit: S8_PROTECTED_BASELINE.commit, fingerprints };
}

function forcedStreamForRow(master, fixture, sourceName = eligibleRows(master, fixture)[0]?.sourceName) {
    const index = master.rows.findIndex(row => row.sourceName === sourceName);
    assert(index >= 0, `${master.key}: missing selected source row ${sourceName}`);
    const row = master.rows[index];
    assert.equal(expectedRowEligibility(row, fixture), true, `${sourceName}: selected S8 row must pass the source oracle`);
    const eligible = eligibleRows(master, fixture);
    const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
    const before = eligible.slice(0, eligible.indexOf(row)).reduce((sum, entry) => sum + entry.weight, 0);
    const values = [(before + row.weight / 2) / total, 0];
    return { row, index, values };
}

function assertNoS8AssignmentSuccess(pages, label) {
    assert.doesNotMatch(pages.join(' '), /we.ll start you off hunting|your new task is to kill|excellent, you.re doing great/i, `${label}: refusal displayed assignment success`);
}

function assertS8NoMutation(player, prior, outcome, label) {
    assert.deepEqual(outcome.taskWrites, [], `${label}: refusal wrote target/count/gem`);
    assert.deepEqual(outcome.inventoryWrites, [], `${label}: refusal wrote inventory`);
    assert.deepEqual(outcome.forcedRandomValues, [], `${label}: refusal consumed RNG`);
    assert.deepEqual(outcome.dispatchCalls, [], `${label}: refusal reached the S1 assignment dispatcher`);
    assert.deepEqual(taskSnapshot(player), prior, `${label}: refusal changed prior task or gem state`);
    assertNoS8AssignmentSuccess(outcome.pages, label);
}

function assertS8SuccessfulAssignment(player, npc, fixture, row, prior, outcome, label) {
    const after = taskSnapshot(player);
    assert.deepEqual(outcome.taskWrites.map(event => event.kind), ['target', 'count'], `${label}: real S1 dispatch must write target then count`);
    assert.deepEqual(outcome.inventoryWrites, [], `${label}: repeat assignment must not write inventory`);
    assert.deepEqual(outcome.dispatchCalls, ['[proc,slayer_new_target]', '[proc,generate_slayer_task]'], `${label}: insist must traverse packed S1 dispatch and selector`);
    assert.equal(after.target, row.target, `${label}: selected task target mismatch`);
    assert(after.count >= row.min && after.count <= row.max, `${label}: selected count outside ${row.sourceName} range`);
    assert.equal(after.gemCount, prior.gemCount, `${label}: assignment added or removed a Slayer gem`);
    const targetIndex = outcome.timeline.findIndex(event => event.kind === 'target');
    const countIndex = outcome.timeline.findIndex(event => event.kind === 'count');
    assert(targetIndex >= 0 && countIndex >= 0, `${label}: missing task varp write from real selector`);
    assert.equal(countIndex, targetIndex + 1, `${label}: dialogue or another write split target/count`);
    assert.equal(outcome.timeline.findIndex(event => event.kind === 'gem'), -1, `${label}: repeat assignment wrote a gem`);
    const successIndex = outcome.timeline.findIndex(event => event.kind === 'dialogue' && /your new task is to kill/i.test(event.text));
    assert(successIndex > countIndex, `${label}: success page must follow adjacent target/count writes`);
    assert.match(outcome.pages.join(' '), /your new task is to kill/i, `${label}: successful assignment page missing`);
    assert.equal(validatorAccepts(player, npc, after.target), true, `${label}: real packed validator rejected selected task`);
    return after;
}

function recordS8Conversation(name, fixture, prior, player, outcome, extra = {}) {
    return {
        name,
        fixture: recordFixture(fixture),
        choices: outcome.choices,
        pages: outcome.pages,
        forcedRandomValues: outcome.forcedRandomValues,
        taskWrites: outcome.taskWrites,
        inventoryWrites: outcome.inventoryWrites,
        dispatchCalls: outcome.dispatchCalls,
        prior,
        after: taskSnapshot(player),
        ...extra
    };
}

function runS8CountZeroAssignment(masterKey, fixture, {
    decision = 'insist',
    sourceName = null,
    expectedWarning,
    expectedBestMasterKey
} = {}) {
    const master = ORACLE.masters.find(candidate => candidate.key === masterKey);
    assert(master, `unknown S8 master ${masterKey}`);
    const player = makePlayer();
    applyFixture(player, fixture);
    assert.equal(combatLevel(player), fixture.combat, `${fixture.key}: count-zero dialogue fixture combat mismatch`);
    const npc = makeNpc(IDS.masters[masterKey]);
    assert.equal(eligibleMaster(player, npc, IDS.masters[masterKey]), true, `${fixture.key}: requested count-zero master must admit`);
    const bestMasterId = runInt(player, '[proc,get_best_slayer_master]').value;
    const recommended = MASTER_DEFS.find(candidate => IDS.masters[candidate.key] === bestMasterId)?.key;
    const exempt = masterKey === 'chaeldar' || masterKey === 'duradel';
    const warningExpected = !exempt && bestMasterId !== IDS.masters[masterKey];
    if (expectedWarning !== undefined) assert.equal(warningExpected, expectedWarning, `${fixture.key}: S8 count-zero warning precondition`);
    if (expectedBestMasterKey !== undefined) assert.equal(recommended, expectedBestMasterKey, `${fixture.key}: best-master precondition`);

    const bearTarget = Number(ORACLE.constants.get('slayer_bear'));
    sentinelTask(player, bearTarget, 0);
    seedExistingGem(player);
    const prior = taskSnapshot(player);
    let selected = null;
    let randomValues = [];
    let choices = [1];
    if (decision === 'decline') {
        assert.equal(warningExpected, true, `${fixture.key}: only a warned assignment can decline here`);
        choices.push(2);
    } else {
        selected = sourceName
            ? forcedStreamForRow(master, fixture, sourceName)
            : forcedStreamForRow(master, fixture);
        randomValues = selected.values;
        if (warningExpected) choices.push(1);
        choices.push(2);
    }

    const outcome = runTrackedDialogue(
        player,
        npc,
        '[opnpc1,_slayer_master]',
        choices,
        randomValues,
        ['slayer_new_target', 'generate_slayer_task']
    );
    const warningSeen = outcome.pages.some(page => /actually very strong|sure you don.t want/i.test(page));
    assert.equal(warningSeen, warningExpected, `${fixture.key}: count-zero warning presence`);
    if (decision === 'decline') {
        assertS8NoMutation(player, prior, outcome, `${fixture.key}: count-zero warning decline`);
        assert.match(outcome.pages.join(' '), /actually very strong/i, `${fixture.key}: warning page missing`);
    } else {
        assert(selected, `${fixture.key}: insist case has no selected real table row`);
        assertS8SuccessfulAssignment(player, npc, fixture, selected.row, prior, outcome, `${fixture.key}: count-zero insist`);
    }

    const record = recordS8Conversation(`${masterKey}-count-zero-${decision}`, fixture, prior, player, outcome, {
        bestMaster: recommended,
        warningExpected,
        selectedSourceRow: selected?.row.sourceName ?? null,
        assignedBy: decision === 'insist' ? masterKey : null,
        taskProvenanceStored: false
    });
    return { record, player, fixture, master, npc, selectedRow: selected?.row ?? null, outcome, prior, bestMasterId };
}

function findCrossMasterEligibleRow(sourceMasterKey, targetMasterKey, fixture) {
    const sourceMaster = ORACLE.masters.find(candidate => candidate.key === sourceMasterKey);
    const targetMaster = ORACLE.masters.find(candidate => candidate.key === targetMasterKey);
    assert(sourceMaster && targetMaster, `missing cross-master source ${sourceMasterKey}/${targetMasterKey}`);
    const targetCategories = new Set(targetMaster.rows.map(row => row.target));
    const row = sourceMaster.rows.find(candidate => targetCategories.has(candidate.target) && expectedRowEligibility(candidate, fixture));
    assert(row, `${sourceMasterKey}: no eligible row also recognized by ${targetMasterKey}`);
    return row;
}

function testS8ReplacementFailure(scriptPack, configs = scriptPack) {
    const compiled = compileFixturePack('replacement-empty-turael');
    const replacementPack = compiled.directory;
    loadRuntime({ scripts: scriptPack, rows: replacementPack, configs });

    const fixture = FIXTURES.get('turael:high');
    const player = makePlayer();
    applyFixture(player, fixture);
    const npc = makeNpc(IDS.masters.turael);
    const nonmemberTarget = Number(ORACLE.constants.get('slayer_earthwarrior'));
    const tableId = rowForPacked('turael_task_table').id;
    const tableReferences = packedValues(rowForPacked('turael_task_table').row, 'task').map(Number);
    const childNames = ['s1_selector_dagannoth', 's1_selector_elf'];
    const childIds = childNames.map(name => rowForPacked(name).id);
    assert.deepEqual(tableReferences, childIds, 'replacement fixture must substitute the Turael list with the two existing adversarial rows');
    const childDefinitions = childNames.map((name, index) => {
        const child = rowForPacked(name).row;
        const target = Number(packedValues(child, 'task')[0]);
        const accepted = validatorAccepts(player, npc, target);
        assert.equal(accepted, false, `${name}: replacement row must be rejected by the real packed validator`);
        return { name, rowId: childIds[index], target, targetName: ORACLE.taskNamesById.get(target) ?? null, realValidatorAccepted: accepted };
    });
    sentinelTask(player, nonmemberTarget, 27);
    assert.equal(runInt(player, '[proc,has_turael_task]').value, 0, 'earth warrior prior task must take the real Turael reassignment consent path');
    seedExistingGem(player);
    const prior = taskSnapshot(player);

    const directTrace = traceWrites(player);
    let direct;
    try {
        direct = withRandomStream([], () => runInt(player, '[proc,generate_slayer_task]', npc, [tableId]));
    } finally {
        directTrace.restore();
    }
    assert.equal(direct.result.value, 0, 'replacement Turael table must make the real selector return false');
    assert.deepEqual(directTrace.events, [], 'replacement selector failure wrote target/count/gem');
    assert.deepEqual(directTrace.inventoryWrites, [], 'replacement selector failure wrote inventory');
    assert.deepEqual(direct.observed, [], 'replacement selector preflight consumed RNG');
    assert.deepEqual(taskSnapshot(player), prior, 'replacement selector failure changed prior task/count/gem');

    const tracedDialogue = tracePackedReturns(['generate_slayer_task'], () => runTrackedDialogue(
        player,
        npc,
        '[opnpc1,_slayer_master]',
        [1, 1],
        [],
        ['slayer_new_target', 'generate_slayer_task']
    ));
    const dialogue = tracedDialogue.result;
    const generatorReturns = tracedDialogue.returns;
    assert.deepEqual(generatorReturns, [{ script: '[proc,generate_slayer_task]', value: 0 }], 'consented replacement dialogue must observe generate_slayer_task returning false');
    assert.deepEqual(dialogue.dispatchCalls, ['[proc,slayer_new_target]', '[proc,generate_slayer_task]'], 'consented replacement dialogue must call real S1 dispatch and generator');
    assert.deepEqual(dialogue.taskWrites, [], 'consented replacement dialogue failure wrote target/count/gem');
    assert.deepEqual(dialogue.inventoryWrites, [], 'consented replacement dialogue failure wrote inventory');
    assert.deepEqual(dialogue.forcedRandomValues, [], 'consented replacement dialogue failure consumed RNG');
    assert.deepEqual(taskSnapshot(player), prior, 'consented replacement dialogue did not preserve prior task/count/gem');
    assert.match(dialogue.pages.join(' '), /yes, please/i, 'replacement failure did not execute the consent choice');
    assertNoS8AssignmentSuccess(dialogue.pages, 'consented replacement dialogue');

    const countZeroPlayer = makePlayer();
    applyFixture(countZeroPlayer, fixture);
    assert.equal(eligibleMaster(countZeroPlayer, npc, IDS.masters.turael), true, 'count-zero failed insist must pass real Turael admission');
    sentinelTask(countZeroPlayer, nonmemberTarget, 0);
    assert.equal(runInt(countZeroPlayer, '[proc,has_turael_task]').value, 0, 'count-zero nonmember must take the real new-task path');
    seedExistingGem(countZeroPlayer);
    const countZeroPrior = taskSnapshot(countZeroPlayer);
    const tracedCountZero = tracePackedReturns(['generate_slayer_task'], () => runTrackedDialogue(
        countZeroPlayer,
        npc,
        '[opnpc1,_slayer_master]',
        [1, 1],
        [],
        ['slayer_new_target', 'generate_slayer_task']
    ));
    const countZeroDialogue = tracedCountZero.result;
    assert.deepEqual(tracedCountZero.returns, [{ script: '[proc,generate_slayer_task]', value: 0 }], 'count-zero failed insist must observe generate_slayer_task returning false');
    assert.deepEqual(countZeroDialogue.dispatchCalls, ['[proc,slayer_new_target]', '[proc,generate_slayer_task]'], 'count-zero failed insist must call real S1 dispatch and generator');
    assert.deepEqual(countZeroDialogue.taskWrites, [], 'count-zero failed insist wrote target/count/gem');
    assert.deepEqual(countZeroDialogue.inventoryWrites, [], 'count-zero failed insist wrote inventory');
    assert.deepEqual(countZeroDialogue.forcedRandomValues, [], 'count-zero failed insist consumed RNG');
    assert.deepEqual(taskSnapshot(countZeroPlayer), countZeroPrior, 'count-zero failed insist changed prior task/count/gem');
    assert.match(countZeroDialogue.pages.join(' '), /actually very strong|sure you don.t want/i, 'count-zero failed insist warning page missing');
    assertNoS8AssignmentSuccess(countZeroDialogue.pages, 'count-zero failed insist');

    return {
        fixture: recordFixture(fixture),
        replacementPack: compiled,
        fixtureDefinitions: {
            mode: compiled.fixtureMode,
            table: 'turael_task_table',
            originalMasterRowsSha256: digestFile(SOURCES.masterRows),
            children: childDefinitions,
            temporaryTableSourceSha256: compiled.temporaryTableOverride?.sourceSha256 ?? null,
            sourceFixtureSha256: FIXTURE_SOURCE_HASH,
            compiledFilesSha256: compiled.files
        },
        directSelector: {
            returnValue: direct.result.value,
            opcount: direct.result.opcount,
            forcedRandomValues: direct.observed,
            taskWrites: directTrace.events,
            inventoryWrites: directTrace.inventoryWrites,
            prior,
            after: taskSnapshot(player)
        },
        consentedDialogue: {
            choices: dialogue.choices,
            pages: dialogue.pages,
            dispatchCalls: dialogue.dispatchCalls,
            forcedRandomValues: dialogue.forcedRandomValues,
            taskWrites: dialogue.taskWrites,
            inventoryWrites: dialogue.inventoryWrites,
            prior,
            after: taskSnapshot(player),
            generatorReturns
        },
        countZeroFailedInsist: {
            choices: countZeroDialogue.choices,
            pages: countZeroDialogue.pages,
            dispatchCalls: countZeroDialogue.dispatchCalls,
            forcedRandomValues: countZeroDialogue.forcedRandomValues,
            generatorReturns: tracedCountZero.returns,
            taskWrites: countZeroDialogue.taskWrites,
            inventoryWrites: countZeroDialogue.inventoryWrites,
            prior: countZeroPrior,
            after: taskSnapshot(countZeroPlayer)
        }
    };
}

function testS8DialogueCases(scriptPack, configs = scriptPack) {
    loadRuntime({ scripts: scriptPack, rows: scriptPack, configs });
    const protectedReaders = testS8ProtectedReaders();
    const taskProcedures = ['slayer_new_target', 'generate_slayer_task'];
    const bearTarget = Number(ORACLE.constants.get('slayer_bear'));
    assert(Number.isInteger(bearTarget), 'S8 bear target constant is missing');
    const turael = ORACLE.masters.find(master => master.key === 'turael');
    const turaelHigh = FIXTURES.get('turael:high');

    const turaelNpc = makeNpc(IDS.masters.turael);
    const ownBear = runS8CountZeroAssignment('turael', turaelHigh, { sourceName: 'turael_bears' });
    assert.equal(ownBear.player.getVar(IDS.target), bearTarget, 'D1 real dialogue must assign bears');
    assert.equal(runInt(ownBear.player, '[proc,has_turael_task]').value, 1, 'D1 bears must be a Turael category');
    const ownBearPrior = taskSnapshot(ownBear.player);
    const ownBearRefusal = runTrackedDialogue(ownBear.player, turaelNpc, '[opnpc1,_slayer_master]', [1], [], taskProcedures);
    assertS8NoMutation(ownBear.player, ownBearPrior, ownBearRefusal, 'D1 positive-count bear refusal');
    assert.match(ownBearRefusal.pages.join(' '), /still hunting something; come back when you.ve finished your task/i, 'D1 bear refusal page missing');
    const bearRefusalRecord = recordS8Conversation('turael-positive-bear-refusal', turaelHigh, ownBearPrior, ownBear.player, ownBearRefusal);

    const nonmemberTarget = Number(ORACLE.constants.get('slayer_earthwarrior'));
    const nonmemberConsentPlayer = makePlayer();
    applyFixture(nonmemberConsentPlayer, turaelHigh);
    sentinelTask(nonmemberConsentPlayer, nonmemberTarget, 31);
    assert.equal(runInt(nonmemberConsentPlayer, '[proc,has_turael_task]').value, 0, 'earth warriors remain outside Turael categories');
    seedExistingGem(nonmemberConsentPlayer);
    const nonmemberConsentPrior = taskSnapshot(nonmemberConsentPlayer);
    const nonmemberForced = forcedStreamForRow(turael, turaelHigh);
    const nonmemberConsent = runTrackedDialogue(nonmemberConsentPlayer, turaelNpc, '[opnpc1,_slayer_master]', [1, 1, 2], nonmemberForced.values, taskProcedures);
    assertS8SuccessfulAssignment(nonmemberConsentPlayer, turaelNpc, turaelHigh, nonmemberForced.row, nonmemberConsentPrior, nonmemberConsent, 'positive-count nonmember consent through Turael');
    assert.match(nonmemberConsent.pages.join(' '), /tougher assignment|new assignment if you.d like/i, 'Turael positive-count consent prompt missing');
    const nonmemberConsentRecord = recordS8Conversation('turael-positive-earthwarrior-consent', turaelHigh, nonmemberConsentPrior, nonmemberConsentPlayer, nonmemberConsent, {
        priorTaskName: 'earthwarrior',
        selectedSourceRow: nonmemberForced.row.sourceName,
        assignedBy: 'turael',
        taskProvenanceStored: false
    });

    const nonmemberDeclinePlayer = makePlayer();
    applyFixture(nonmemberDeclinePlayer, turaelHigh);
    sentinelTask(nonmemberDeclinePlayer, nonmemberTarget, 31);
    seedExistingGem(nonmemberDeclinePlayer);
    const nonmemberDeclinePrior = taskSnapshot(nonmemberDeclinePlayer);
    const nonmemberDecline = runTrackedDialogue(nonmemberDeclinePlayer, turaelNpc, '[opnpc1,_slayer_master]', [1, 2], [], taskProcedures);
    assertS8NoMutation(nonmemberDeclinePlayer, nonmemberDeclinePrior, nonmemberDecline, 'positive-count nonmember decline through Turael');
    assert.match(nonmemberDecline.pages.join(' '), /tougher assignment|new assignment if you.d like/i, 'Turael positive-count decline prompt missing');
    const nonmemberDeclineRecord = recordS8Conversation('turael-positive-earthwarrior-decline', turaelHigh, nonmemberDeclinePrior, nonmemberDeclinePlayer, nonmemberDecline, { priorTaskName: 'earthwarrior' });

    const highFixture = FIXTURES.get('turael:high');
    const crossRow = findCrossMasterEligibleRow('mazchna', 'turael', highFixture);
    const mazchnaCross = runS8CountZeroAssignment('mazchna', FIXTURES.get('mazchna:high'), {
        decision: 'insist',
        sourceName: crossRow.sourceName,
        expectedWarning: true,
        expectedBestMasterKey: 'duradel'
    });
    assert.equal(mazchnaCross.selectedRow.target, crossRow.target, 'Mazchna actual assignment must select the cross-master category');
    assert.equal(runInt(mazchnaCross.player, '[proc,has_turael_task]').value, 1, 'category assigned by Mazchna must be recognized by Turael without provenance');
    assert(mazchnaCross.master.rows.some(row => row.target === crossRow.target), 'cross-master task source must be present in Mazchna table');
    assert(turael.rows.some(row => row.target === crossRow.target), 'cross-master task category must be present in Turael predicate source');
    const categoryPrior = taskSnapshot(mazchnaCross.player);
    const categoryRefusal = runTrackedDialogue(mazchnaCross.player, turaelNpc, '[opnpc1,_slayer_master]', [1], [], taskProcedures);
    assertS8NoMutation(mazchnaCross.player, categoryPrior, categoryRefusal, 'Turael positive-count refusal for category assigned by Mazchna');
    assert.match(categoryRefusal.pages.join(' '), /still hunting something; come back when you.ve finished your task/i, 'Turael category refusal page missing');
    const categoryRefusalRecord = recordS8Conversation('turael-category-refusal-from-mazchna', mazchnaCross.fixture, categoryPrior, mazchnaCross.player, categoryRefusal, {
        assignedBy: 'mazchna via real packed dialogue and S1 dispatch',
        taskProvenanceStored: false,
        targetRecognizedByTuraelPredicate: true,
        sourceRow: mazchnaCross.selectedRow.sourceName
    });

    const warningDeclines = ['turael', 'mazchna', 'vannaka'].map(masterKey => runS8CountZeroAssignment(masterKey, FIXTURES.get(`${masterKey}:high`), {
        decision: 'decline',
        expectedWarning: true,
        expectedBestMasterKey: 'duradel'
    }).record);
    const turaelWarningInsist = runS8CountZeroAssignment('turael', FIXTURES.get('turael:high'), {
        decision: 'insist',
        expectedWarning: true,
        expectedBestMasterKey: 'duradel'
    });
    const mazchnaWarningInsist = mazchnaCross;
    const vannakaWarningInsist = runS8CountZeroAssignment('vannaka', FIXTURES.get('vannaka:high'), {
        decision: 'insist',
        expectedWarning: true,
        expectedBestMasterKey: 'duradel'
    });
    const warningInsists = [turaelWarningInsist.record, mazchnaWarningInsist.record, vannakaWarningInsist.record];

    const otherMasterRefusals = [];
    for (const master of ORACLE.masters.slice(1)) {
        const npc = makeNpc(IDS.masters[master.key]);
        assert.equal(eligibleMaster(turaelWarningInsist.player, npc, IDS.masters[master.key]), true, `${master.key}: high fixture must admit this repeat-refusal check`);
        const prior = taskSnapshot(turaelWarningInsist.player);
        assert(prior.count > 0, `${master.key}: S8 another-master refusal needs a positive count`);
        const outcome = runTrackedDialogue(turaelWarningInsist.player, npc, '[opnpc1,_slayer_master]', [1], [], taskProcedures);
        assertS8NoMutation(turaelWarningInsist.player, prior, outcome, `${master.key} positive-count refusal of a Turael-assigned task`);
        assert.match(outcome.pages.join(' '), /still hunting something; come back when you.ve finished your task/i, `${master.key}: positive-count refusal page missing`);
        otherMasterRefusals.push(recordS8Conversation(`${master.key}-positive-count-refusal-from-turael`, turaelWarningInsist.fixture, prior, turaelWarningInsist.player, outcome, {
            assignedBy: 'turael via real packed dialogue and S1 dispatch',
            taskProvenanceStored: false
        }));
    }

    const underqualified = underqualifiedChaeldarFixture();
    const underqualifiedNpc = makeNpc(IDS.masters.chaeldar);
    assert.equal(eligibleMaster(underqualified.player, underqualifiedNpc, IDS.masters.chaeldar), false, 'underqualified repeat fixture must still fail real Chaeldar admission');
    sentinelTask(underqualified.player, bearTarget, 19);
    seedExistingGem(underqualified.player);
    const underqualifiedPrior = taskSnapshot(underqualified.player);
    const underqualifiedRepeat = runTrackedDialogue(underqualified.player, underqualifiedNpc, '[opnpc1,_slayer_master]', [1], [], taskProcedures);
    assertS8NoMutation(underqualified.player, underqualifiedPrior, underqualifiedRepeat, 'underqualified repeat assignment refusal');
    assert.match(underqualifiedRepeat.pages.join(' '), /not strong enough to be taught by me/i, 'underqualified repeat refusal page missing');
    const underqualifiedRecord = recordS8Conversation('underqualified-repeat-refusal', underqualified.fixture, underqualifiedPrior, underqualified.player, underqualifiedRepeat);

    const alreadyBest = ['turael', 'mazchna', 'vannaka'].map(masterKey => runS8CountZeroAssignment(masterKey, FIXTURES.get(`${masterKey}:minimum`), {
        decision: 'insist',
        expectedWarning: false,
        expectedBestMasterKey: masterKey
    }).record);
    const warningExemptions = ['chaeldar', 'duradel'].map(masterKey => runS8CountZeroAssignment(masterKey, FIXTURES.get(`${masterKey}:high`), {
        decision: 'insist',
        expectedWarning: false,
        expectedBestMasterKey: 'duradel'
    }).record);

    const gemReaderPlayer = makePlayer();
    applyFixture(gemReaderPlayer, turaelHigh);
    const gemReaderCount = 23;
    sentinelTask(gemReaderPlayer, bearTarget, gemReaderCount);
    seedExistingGem(gemReaderPlayer);
    const gemReaderPrior = taskSnapshot(gemReaderPlayer);
    const gemReader = runTrackedDialogue(gemReaderPlayer, null, '[opheld1,slayer_gem]', [1, 4], [], []);
    assertS8NoMutation(gemReaderPlayer, gemReaderPrior, gemReader, 'Slayer gem task reader');
    const expectedTaskName = (ORACLE.taskNamesById.get(bearTarget) ?? '').toLowerCase();
    assert(expectedTaskName, 'bear task name is missing from the real packed task-name oracle');
    assert(gemReader.pages.join(' ').toLowerCase().includes(`currently assigned to kill ${expectedTaskName}; only ${gemReaderCount} more to go`), 'Slayer gem reader did not output the real task name and count');
    const gemReaderRecord = recordS8Conversation('slayer-gem-real-task-reader', turaelHigh, gemReaderPrior, gemReaderPlayer, gemReader, {
        selectedTaskName: expectedTaskName,
        selectedCount: gemReaderCount
    });

    const replacementFailure = testS8ReplacementFailure(scriptPack, configs);
    loadRuntime({ scripts: scriptPack, rows: scriptPack, configs });
    return {
        protectedReaders,
        positiveCount: {
            bearAssignment: ownBear.record,
            bearRefusal: bearRefusalRecord,
            nonmemberConsent: nonmemberConsentRecord,
            nonmemberDecline: nonmemberDeclineRecord,
            turaelCategoryRefusalFromAnotherMaster: categoryRefusalRecord,
            otherMasterRefusals
        },
        countZero: {
            warningDeclines,
            warningInsists,
            alreadyBestNoWarning: alreadyBest,
            masterFourFiveWarningExemptions: warningExemptions
        },
        underqualifiedRepeatRefusal: underqualifiedRecord,
        gemReader: gemReaderRecord,
        replacementFailure
    };
}

function buildDistribution(master, fixture, rows) {
    const eligible = rows.filter(row => expectedRowEligibility(row, fixture));
    const totalWeight = eligible.reduce((sum, row) => sum + row.weight, 0);
    assert(totalWeight > 0, `${master.key}/${fixture.key}: no eligible proportional weight`);
    const categoryProbability = new Map();
    for (const row of eligible) {
        categoryProbability.set(row.target, (categoryProbability.get(row.target) ?? 0) + row.weight / totalWeight);
    }
    return { categoryProbability, totalWeight };
}

function enumerateProportionalRoll(master, fixture, table = null) {
    const player = makePlayer();
    applyFixture(player, fixture);
    assert.equal(combatLevel(player), fixture.combat, `${fixture.key}: enumeration combat`);
    const npc = makeNpc(IDS.masters[master.key]);
    const select = () => table === null
        ? runInt(player, '[proc,slayer_new_target]', npc)
        : runInt(player, '[proc,generate_slayer_task]', npc, [table]);
    const eligible = eligibleRows(master, fixture);
    const total = eligible.reduce((sum, row) => sum + row.weight, 0);
    const counts = new Map(master.rows.map(row => [row.sourceName, 0]));
    let expectedIndex = 0;
    let boundary = eligible[0]?.weight ?? 0;
    for (let roll = 0; roll < total; roll++) {
        while (roll >= boundary) boundary += eligible[++expectedIndex].weight;
        const expected = eligible[expectedIndex];
        sentinelTask(player);
        const trace = traceWrites(player);
        let draw;
        try {
            draw = withRandomStream([(roll + 0.5) / total, 0], select);
        } finally {
            trace.restore();
        }
        assert.equal(draw.result.value, 1, `${fixture.key}/roll${roll}: nonempty eligible set`);
        assert.equal(player.getVar(IDS.target), expected.target, `${fixture.key}/roll${roll}: exact eligible weighted bucket`);
        assert.equal(player.getVar(IDS.count), expected.min, `${fixture.key}/roll${roll}: unchanged amount lower endpoint`);
        assert.deepEqual(trace.events, [{ kind: 'target', value: expected.target }, { kind: 'count', value: expected.min }], `${fixture.key}/roll${roll}: atomic assignment order`);
        assert.equal(gemCount(player), 0, 'selector must not grant a gem');
        counts.set(expected.sourceName, counts.get(expected.sourceName) + 1);
    }
    if (total === 0) {
        const prior = sentinelTask(player);
        const trace = traceWrites(player);
        let draw;
        try {
            draw = withRandomStream([], select);
        } finally {
            trace.restore();
        }
        assert.deepEqual(trace.events, [], 'empty set must not write task state');
        assert.equal(gemCount(player), 0, 'empty set must not grant a gem');
        assert.equal(draw.result.value, 0, `${fixture.key}: empty eligible set`);
        assert.equal(player.getVar(IDS.target), prior.target, 'empty set must preserve the prior target');
        assert.equal(player.getVar(IDS.count), prior.count, 'empty set must preserve the prior count');
    }
    for (const row of master.rows) {
        assert.equal(counts.get(row.sourceName), expectedRowEligibility(row, fixture) ? row.weight : 0, `${fixture.key}/${row.sourceName}: exact eligible mass`);
    }
    return { master: master.key, fixture: recordFixture(fixture), totalWeight: total, counts: Object.fromEntries(counts) };
}

function exactCombatFixture(fixture, combat) {
    // Fixture only: find ordinary equal combat stats plus Prayer for the exact boundary.
    for (let level = 1; level <= 99; level++) {
        for (let prayer = 1; prayer <= 99; prayer++) {
            const base = 10 * (2 * level + Math.floor(prayer / 2));
            const actual = Math.floor((base + Math.max(26 * level, 13 * Math.floor(3 * level / 2))) / 40);
            if (actual === combat) return { ...fixture, combat, level, baseCombatSkills: { [PlayerStat.PRAYER]: prayer } };
        }
    }
    throw new Error(`unreachable combat fixture ${combat}`);
}

function testProportionalRoll(packedRows) {
    const distributions = [];
    for (const master of ORACLE.masters) {
        const packed = packedRows.get(master.key);
        for (const kind of ['minimum', 'high']) distributions.push(enumerateProportionalRoll(packed, FIXTURES.get(`${master.key}:${kind}`)));
    }
    const turael = distributions.find(row => row.master === 'turael' && row.fixture.baseSlayer === 99);
    const oracleMaster = ORACLE.masters.find(master => master.key === 'turael');
    const oracleRows = eligibleRows(oracleMaster, FIXTURES.get('turael:high'));
    const expectedTotal = oracleRows.reduce((sum, row) => sum + row.weight, 0);
    assert.equal(turael.totalWeight, expectedTotal, 'high Turael total matches the independent table and eligibility oracle');
    const percentages = {};
    for (const name of ['rats', 'bears']) {
        const row = oracleRows.find(row => row.sourceName === `turael_${name}`);
        assert(row, `${name}: eligible oracle row required`);
        const count = turael.counts[row.sourceName];
        assert.equal(count, row.weight, `${name}: exact bucket mass matches the table`);
        percentages[name] = (100 * count / turael.totalWeight).toFixed(2);
        assert.equal(percentages[name], (100 * row.weight / expectedTotal).toFixed(2), `${name}: proportional probability matches the table`);
    }
    const additions = [];
    for (const [masterKey, suffix, donorKey, donorSuffix] of [
        ['mazchna', 'mossgiants', 'vannaka', 'mossgiants'],
        ['chaeldar', 'crawlinghands', 'vannaka', 'crawlinghands'],
        ['duradel', 'bronzedragons', 'chaeldar', 'bronzedragons'],
        ['duradel', 'turoths', 'chaeldar', 'turoths']
    ]) {
        const master = packedRows.get(masterKey);
        const row = master.rows.find(entry => entry.sourceName === `${masterKey}_${suffix}`);
        const donor = packedRows.get(donorKey).rows.find(entry => entry.sourceName === `${donorKey}_${donorSuffix}`);
        assert(row && donor, `${masterKey}_${suffix}: real membership and donor required`);
        assert.deepEqual([row.target, row.weight, row.min, row.max], [donor.target, donor.weight, donor.min, donor.max], 'UNKNOWN engineering row must retain the disclosed donor values');
        const high = { ...FIXTURES.get(`${masterKey}:high`), questValues: completedQuestValues() };
        const cases = [{ ...high, key: `${row.sourceName}_eligible` }];
        const slayer = ORACLE.slayerReq.get(row.target) ?? 0;
        if (slayer > 1) {
            for (const baseSlayer of [slayer - 1, slayer]) cases.push({ ...high, key: `${row.sourceName}_slayer${baseSlayer}`, baseSlayer, currentSlayer: 1 });
        }
        const combat = ORACLE.combatReq.get(row.target) ?? 0;
        if (combat > 3) {
            for (const level of [combat - 1, combat]) cases.push({ ...exactCombatFixture(high, level), key: `${row.sourceName}_cb${level}` });
        }
        if (suffix === 'crawlinghands') {
            for (const priestperil of [60, 61]) cases.push({ ...high, key: `${row.sourceName}_priestperil${priestperil}`, questValues: { ...high.questValues, priestperil } });
        }
        const outcomes = cases.map(fixture => enumerateProportionalRoll(master, fixture));
        assert(outcomes.some(outcome => outcome.counts[row.sourceName] === row.weight), 'new row needs a real eligible assignment');
        if (slayer > 1 || combat > 3 || suffix === 'crawlinghands') assert(outcomes.some(outcome => outcome.counts[row.sourceName] === 0), 'gated row needs a real excluded case');
        additions.push({ row: row.sourceName, donor: donor.sourceName, engineeringLabel: 'UNKNOWN', outcomes });
    }
    console.log(`PASS proportional exact enumeration: rats=${percentages.rats}%, bears=${percentages.bears}%; four borrowed rows retain eligibility`);
    return { distributions, additions, sheetFixture: { totalWeight: turael.totalWeight, ...percentages } };
}

class GzipJsonlWriter {
    constructor(file) {
        this.file = file;
        this.output = fs.createWriteStream(file);
        this.gzip = createGzip({ level: 9 });
        this.gzip.pipe(this.output);
        this.buffer = '';
        this.pendingDrain = null;
        this.chunkLimit = 256 * 1024;
    }
    write(record) {
        this.buffer += `${JSON.stringify(record)}\n`;
        return this.buffer.length >= this.chunkLimit ? this.flushChunk() : null;
    }
    async flushChunk() {
        if (this.pendingDrain) {
            await this.pendingDrain;
            this.pendingDrain = null;
        }
        const chunk = this.buffer;
        this.buffer = '';
        if (chunk && !this.gzip.write(chunk)) this.pendingDrain = once(this.gzip, 'drain');
    }
    async close() {
        if (this.buffer) await this.flushChunk();
        if (this.pendingDrain) {
            await this.pendingDrain;
            this.pendingDrain = null;
        }
        this.gzip.end();
        await finished(this.output);
    }
}

function binBound(probability, sampleCount) {
    if (probability === 0 || probability === 1) return 0;
    return Math.ceil(Math.sqrt(2 * sampleCount * probability * (1 - probability) * LOG_BOUND) + (2 * LOG_BOUND) / 3);
}

function makeCountMap() {
    return new Map(Array.from({ length: 76 }, (_, category) => [category, 0]));
}

function locateOccurrence(master, fixture, target, count, randomCalls, acceptance) {
    assert.equal(randomCalls, 2, `${master.key}/${fixture.key}: one category draw and one unchanged amount draw required`);
    const row = master.rows.find(entry => entry.target === target && expectedRowEligibility(entry, fixture) && count >= entry.min && count <= entry.max);
    assert(row, `${master.key}/${fixture.key}: selected target/count lacks an eligible occurrence`);
    assert.equal(acceptance.get(target), true, `${master.key}/${fixture.key}: selected target lacks actual validator acceptance`);
    return { row, retries: 0 };
}

async function runDistribution(master, fixture, packedRows, acceptance, drawsPerSeed = DRAWS_PER_SEED) {
    const actualMaster = packedRows.get(master.key);
    const model = buildDistribution(master, fixture, actualMaster.rows);
    for (const category of [0, ...ORACLE.taskNamesById.keys()]) assert(category >= 0 && category <= 75, `category ${category} is outside fixed 0..75 family`);
    const fixtureSlug = fixture.key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputPath = path.join(RUN_DIR, `draws-${master.key}-${fixtureSlug}.jsonl.gz`);
    const writer = new GzipJsonlWriter(outputPath);
    const combined = makeCountMap();
    const perSeedBins = [];
    const player = makePlayer();
    applyFixture(player, fixture);
    assert.equal(combatLevel(player), fixture.combat, `${fixture.key}: actual player_combat_level changed before draws`);
    const npc = makeNpc(IDS.masters[master.key]);
    const positiveWeights = actualMaster.rows.filter(row => row.weight > 0).length;
    assert(positiveWeights > 0, `${master.key}: no positive category weights`);
    const originalNextDouble = JavaRandom.nextDouble;
    let totalRandomCalls = 0;
    JavaRandom.nextDouble = function () {
        totalRandomCalls++;
        return originalNextDouble.call(this);
    };
    try {
        for (const seed of SEEDS) {
            JavaRandom.setSeed(seed);
            const counts = makeCountMap();
            const sequenceStartCalls = totalRandomCalls;
            for (let draw = 0; draw < drawsPerSeed; draw++) {
                const randomCallsBefore = totalRandomCalls;
                const messagesBefore = player.messages.length;
                const result = runInt(player, '[proc,slayer_new_target]', npc);
                const randomCalls = totalRandomCalls - randomCallsBefore;
                assert.equal(result.value, 1, `${master.key}/${fixture.key}/seed${seed}/draw${draw}: selector failed`);
                const target = player.getVar(IDS.target);
                const count = player.getVar(IDS.count);
                assert(target >= 0 && target <= 75, `invalid category ${target} outside the declared family`);
                const located = locateOccurrence(master, fixture, target, count, randomCalls, acceptance);
                assert.equal(expectedValidator(target, fixture), true, `source oracle rejected selected target ${target}`);
                assert.equal(acceptance.get(target), true, `packed validator rejected selected target ${target}`);
                assert.equal(player.messages.length, messagesBefore, 'direct selector unexpectedly emitted a message');
                assert.equal(gemCount(player), 0, 'direct selector unexpectedly granted a gem');
                counts.set(target, counts.get(target) + 1);
                combined.set(target, combined.get(target) + 1);
                const record = {
                    master: master.key,
                    fixture: fixture.key,
                    seed,
                    draw,
                    target,
                    targetName: ORACLE.taskNamesById.get(target),
                    count,
                    occurrence: located.row.sourceName,
                    occurrenceIndex: located.row.occurrenceIndex,
                    retries: located.retries,
                    categoryRandomCalls: randomCalls - 1,
                    amountRandomCalls: 1,
                    allRandomCalls: randomCalls,
                    opcount: result.opcount
                };
                const pending = writer.write(record);
                if (pending) await pending;
            }
            perSeedBins.push({ seed, counts, firstRandomCall: sequenceStartCalls, finalRandomCalls: totalRandomCalls });
        }
    } finally {
        JavaRandom.nextDouble = originalNextDouble;
        await writer.close();
    }

    const bins = [];
    for (const { seed, counts } of perSeedBins) {
        for (let category = 0; category < 76; category++) {
            const probability = model.categoryProbability.get(category) ?? 0;
            const observed = counts.get(category);
            const sampleCount = drawsPerSeed;
            const bound = binBound(probability, sampleCount);
            const expectedCount = sampleCount * probability;
            assert(probability === 0 ? observed === 0 : Math.abs(observed - expectedCount) <= bound,
                `${master.key}/${fixture.key}/seed${seed}/category${category}: observed ${observed}, expected ${expectedCount}, P=${probability}, bound=${bound}`);
            bins.push({ master: master.key, fixture: fixture.key, assertion: `seed:${seed}`, category, P: probability, N: sampleCount, bound, count: observed });
        }
    }
    for (let category = 0; category < 76; category++) {
        const probability = model.categoryProbability.get(category) ?? 0;
        const observed = combined.get(category);
        const sampleCount = drawsPerSeed * SEEDS.length;
        const bound = binBound(probability, sampleCount);
        const expectedCount = sampleCount * probability;
        assert(probability === 0 ? observed === 0 : Math.abs(observed - expectedCount) <= bound,
            `${master.key}/${fixture.key}/combined/category${category}: observed ${observed}, expected ${expectedCount}, P=${probability}, bound=${bound}`);
        bins.push({ master: master.key, fixture: fixture.key, assertion: 'combined', category, P: probability, N: sampleCount, bound, count: observed });
    }

    return {
        bins,
        draws: drawsPerSeed * SEEDS.length,
        seedCount: SEEDS.length,
        seeds: SEEDS,
        outputPath,
        outputSha256: digestFile(outputPath),
        categoryCount: 76,
        eligibleWeight: model.totalWeight,
        positiveRows: positiveWeights,
        fixture: recordFixture(fixture)
    };
}

function testCurrentSuite() {
    loadRuntime({ scripts: ACTIVE_PACK_DIR, rows: ACTIVE_PACK_DIR });
    const packedRows = assertPackedLiveRows();
    const masterSnapshots = testMasterSnapshots();
    const turaelPredicate = testTuraelPredicate();
    const d1Bears = testD1Bears();
    assert.deepEqual(Object.keys(MASTER_TABLES), MASTER_DEFS.map(master => master.key), 'all five fixed labelled master snapshots are required');
    const ernest = ['mazchna', 'vannaka'].map(testErnestGate);
    const chaeldarRetargets = testChaeldarRetargets();
    const duradelTables = testDuradelTables();
    const admission = testCombatAndMasterAdmission();
    const harpieThreshold = testHarpieThreshold();
    const thresholds = testThresholds();
    const currentStatSource = testCurrentSlayerDoesNotGateAssignment();
    const ownerPredicateDispatch = testOwnerPredicateDispatch();
    const priestperilAccess = testPriestperilAccess();
    const skippyAccess = testSkippyAccess();
    const fixtureValidatorCaches = new Map();
    const emptyMinimumFailures = [];
    for (const master of ORACLE.masters) {
        for (const fixtureKind of ['minimum', 'high']) {
            const fixture = FIXTURES.get(`${master.key}:${fixtureKind}`);
            const effective = eligibleRows(master, fixture);
            const player = makePlayer();
            applyFixture(player, fixture);
            assert.equal(combatLevel(player), fixture.combat, `${fixture.key}: actual combat-level fixture mismatch`);
            const npc = makeNpc(IDS.masters[master.key]);
            const targets = [...ORACLE.taskNamesById.keys(), ...master.rows.map(row => row.target)];
            const acceptance = buildActualValidatorCache(player, npc, fixture, targets, fixture.key);
            for (const row of master.rows) {
                assert.equal(acceptance.get(row.target), expectedValidator(row.target, fixture), `${fixture.key}/${row.sourceName}: actual validator/source oracle mismatch`);
                assert.equal(expectedRowEligibility(row, fixture), row.weight > 0 && row.min <= row.max && ORACLE.taskNamesById.has(row.target) && acceptance.get(row.target), `${fixture.key}/${row.sourceName}: independent row eligibility mismatch`);
            }
            fixtureValidatorCaches.set(`${master.key}:${fixtureKind}`, acceptance);
            if (fixtureKind === 'minimum' && fixture.emptyMinimumFixture) {
                const exact = fixture.emptyMinimumFixture;
                assert.equal(eligibleRows(master, exact).length, 0, `${exact.key}: empty-minimum fallback precondition changed`);
                const emptyPlayer = makePlayer();
                applyFixture(emptyPlayer, exact);
                assert.equal(combatLevel(emptyPlayer), exact.combat, `${exact.key}: exact minimum combat level mismatch`);
                const prior = sentinelTask(emptyPlayer, 31415, 9265);
                const trace = traceWrites(emptyPlayer);
                JavaRandom.setSeed(1);
                const random = withRandomStream([], () => runInt(emptyPlayer, '[proc,generate_slayer_task]', makeNpc(IDS.masters[master.key]), [configTypes.DbRowType.getId(master.table)]));
                trace.restore();
                assert.equal(random.result.value, 0, `${exact.key}: empty minimum fixture must return false`);
                assert.deepEqual(trace.events, [], `${exact.key}: empty minimum fixture wrote task state`);
                assert.equal(emptyPlayer.getVar(IDS.target), prior.target);
                assert.equal(emptyPlayer.getVar(IDS.count), prior.count);
                assert.equal(gemCount(emptyPlayer), 0);
                emptyMinimumFailures.push({ exactMinimum: recordFixture(exact), firstNonempty: recordFixture(fixture), opcount: random.result.opcount });
            }
        }
    }

    const dispatch = testDispatchAndOneShotOrder(packedRows);
    const teachingAdmission = testCurrentTeachingAdmission();
    const teachingSuccess = testCurrentTeachingSuccess();
    return { packedRows, masterSnapshots, turaelPredicate, d1Bears, ernest, chaeldarRetargets, duradelTables, admission, harpieThreshold, thresholds, currentStatSource, ownerPredicateDispatch, priestperilAccess, skippyAccess, dispatch, teaching: { admission: teachingAdmission, success: teachingSuccess }, emptyMinimumFailures, fixtureValidatorCaches };
}

function fixtureSourceRows() {
    return parseDbRowFile(FIXTURE_SOURCE_PATH);
}

function assertFixturePackMembership(fixtureRows) {
    const fixtureTableId = configTypes.DbTableType.getId('slayer_task_table');
    const fixtureTaskTableId = configTypes.DbTableType.getId('slayer_master_task');
    const checks = [];
    for (const [name, sourceRow] of fixtureRows) {
        const { row, id } = rowForPacked(name);
        assert.equal(row.tableId, sourceRow.table === 'slayer_task_table' ? fixtureTableId : fixtureTaskTableId, `${name}: compiled fixture table mismatch`);
        for (const [column, rawValues] of sourceRow.data) {
            const actual = packedValues(row, column);
            assert.equal(actual.length, rawValues.length, `${name}.${column}: packed field count differs from source`);
            const values = sourceRow.table === 'slayer_task_table' && column === 'task'
                ? rawValues.map(raw => configTypes.DbRowType.getId(raw))
                : rawValues.map(raw => sourceValue(raw, ORACLE.constants, `${name}.${column}`));
            assert.deepEqual(actual.map(value => typeof value === 'string' ? value : Number(value)), values, `${name}.${column}: packed values differ from fixture source`);
        }
        checks.push({ name, id, table: sourceRow.table });
    }
    return checks;
}

function testMissingListEngineBoundary(scripts) {
    loadRuntime({ scripts, rows: FIXTURE_PACK_DIR });
    const player = makePlayer();
    applyFixture(player, FIXTURES.get('turael:high'));
    const prior = sentinelTask(player, 321, 654);
    const { id, row } = rowForPacked('s1_selector_fixture_empty');
    assert.equal(row.columnValues[0], undefined, 'minimal missing-list fixture no longer reproduces the pinned engine representation');
    const trace = traceWrites(player);
    const attempted = withRandomStream([], () => runRaw(player, '[proc,generate_slayer_task]', makeNpc(IDS.masters.turael), [id]));
    trace.restore();
    assert.equal(attempted.result.exec, ScriptState.ABORTED, 'pinned engine no longer aborts on the missing-list column');
    assert.deepEqual(trace.events, [], 'missing-list engine abort wrote task or gem state');
    assert.equal(player.getVar(IDS.target), prior.target);
    assert.equal(player.getVar(IDS.count), prior.count);
    assert.equal(gemCount(player), 0);
    assert.doesNotMatch(dialogueText(player), /we.ll start you off hunting|your new task is to kill/i);
    return {
        status: 'ENGINE_LIMITATION',
        fixture: 's1_selector_fixture_empty',
        owner: 'engine follow-up, outside S1',
        cause: 'DbOps.ts:149 DB_GETFIELDCOUNT reads undefined columnValues[0].length',
        exec: attempted.result.exec,
        opcount: attempted.result.opcount,
        engineMessages: [...player.messages],
        prior,
        writes: trace.events,
        randomValues: attempted.observed
    };
}

function testAdversarialFixtures() {
    loadRuntime({ scripts: FIXTURE_PACK_DIR, rows: FIXTURE_PACK_DIR });
    const fixtureRows = fixtureSourceRows();
    const membership = assertFixturePackMembership(fixtureRows);
    const master = ORACLE.masters.find(value => value.key === 'turael');
    const fixture = FIXTURES.get('turael:high');
    const player = makePlayer();
    applyFixture(player, fixture);
    const npc = makeNpc(IDS.masters.turael);
    const selector = '[proc,generate_slayer_task]';
    const falseCases = [
        ['s1_selector_fixture_all_ineligible', ['s1_selector_dagannoth', 's1_selector_elf']],
        ['s1_selector_fixture_nonpositive', ['s1_selector_zero_weight', 's1_selector_negative_weight']],
        ['s1_selector_fixture_inverted', ['s1_selector_inverted_range']],
        ['s1_selector_fixture_unresolved', ['s1_selector_unresolved_target']]
    ];
    const results = [];
    for (const [masterName, rows] of falseCases) {
        const { id: masterId } = rowForPacked(masterName);
        const prior = sentinelTask(player, 700000 + results.length, 800000 + results.length);
        const trace = traceWrites(player);
        const random = withRandomStream([], () => runInt(player, selector, npc, [masterId]));
        trace.restore();
        assert.equal(random.result.value, 0, `${masterName}: invalid/empty eligible set must fail closed`);
        assert.deepEqual(trace.events, [], `${masterName}: false result wrote task target/count or gem`);
        assert.equal(player.getVar(IDS.target), prior.target, `${masterName}: false result changed prior target`);
        assert.equal(player.getVar(IDS.count), prior.count, `${masterName}: false result changed prior count`);
        assert.equal(gemCount(player), 0, `${masterName}: false result granted a gem`);
        assert.equal(player.messages.length, 0, `${masterName}: false result emitted success text`);
        for (const childName of rows) {
            const child = rowForPacked(childName).row;
            const target = Number(packedValues(child, 'task')[0]);
            const actual = validatorAccepts(player, npc, target);
            if (childName === 's1_selector_dagannoth' || childName === 's1_selector_elf') assert.equal(actual, false, `${childName}: expected the real validator to reject this row`);
            results.push({ fixture: masterName, child: childName, actualValidatorAcceptance: actual });
        }
        results.push({ fixture: masterName, selector: false, writes: trace.events, prior, opcount: random.result.opcount, randomValues: random.observed });
        if (masterName === 's1_selector_fixture_all_ineligible') {
            // Exercise the enumeration's zero-total branch with the same real compiled table.
            const emptyRows = rows.map(sourceName => {
                const child = rowForPacked(sourceName).row;
                return {
                    sourceName,
                    target: Number(packedValues(child, 'task')[0]),
                    weight: Number(packedValues(child, 'weight')[0]),
                    min: Number(packedValues(child, 'min_amount')[0]),
                    max: Number(packedValues(child, 'max_amount')[0])
                };
            });
            const enumeration = enumerateProportionalRoll({ ...master, rows: emptyRows }, fixture, masterId);
            assert.equal(enumeration.totalWeight, 0, 'registered all-ineligible fixture reaches the zero-total enumeration branch');
            results.push({ fixture: masterName, enumeration });
        }
    }

    // A test-only two-row compiled table proves that rejected rows have no bucket.
    const mixedId = rowForPacked('s1_selector_fixture_rejected_then_valid').id;
    const mixed = rowForPacked('s1_selector_fixture_rejected_then_valid');
    const mixedChildIds = packedValues(mixed.row, 'task');
    assert.equal(mixedChildIds.length, 2, 'mixed fixture must retain both ordered occurrences');
    const rejectedTarget = Number(packedValues(configTypes.DbRowType.get(Number(mixedChildIds[0])), 'task')[0]);
    const acceptedTarget = Number(packedValues(configTypes.DbRowType.get(Number(mixedChildIds[1])), 'task')[0]);
    assert.equal(validatorAccepts(player, npc, rejectedTarget), false, 'mixed first row must be rejected by real validator');
    assert.equal(validatorAccepts(player, npc, acceptedTarget), true, 'mixed second row must pass real validator');
    sentinelTask(player, 23, 45);
    const trace = traceWrites(player);
    JavaRandom.setSeed(1);
    const mixedRun = withRandomStream([0, 0], () => runInt(player, selector, npc, [mixedId]));
    trace.restore();
    assert.equal(mixedRun.result.value, 1, 'mixed selector must succeed with its sole eligible bucket');
    assert.equal(player.getVar(IDS.target), acceptedTarget, 'mixed selector must exclude the rejected bucket');
    assert.equal(player.getVar(IDS.count), 1, 'mixed fixture inclusive amount lower endpoint mismatch');
    assert.deepEqual(mixedRun.observed, [0, 0], 'eligible category and amount must use exactly two random opcode calls');
    assert.deepEqual(trace.events.map(event => event.kind), ['target', 'count'], 'mixed selector must write target then count');
    assert.equal(gemCount(player), 0, 'selector-only mixed fixture must not grant gem');
    results.push({ fixture: 's1_selector_fixture_rejected_then_valid', rejectedTarget, acceptedTarget, success: true, randomValues: mixedRun.observed, writes: trace.events, opcount: mixedRun.result.opcount });

    const unrecognized = packEntries('npc').find(([name]) => !MASTER_DEFS.some(masterDef => masterDef.npc === name) && configTypes.NpcType.get(packId('npc', name)));
    assert(unrecognized, 'nonmaster NPC missing for fixture dispatcher check');
    const nonMaster = makeNpc(unrecognized[1]);
    const prior = sentinelTask(player, 99, 88);
    const nonMasterTrace = traceWrites(player);
    const dispatch = runInt(player, '[proc,slayer_new_target]', nonMaster);
    nonMasterTrace.restore();
    assert.equal(dispatch.value, 0, 'unrecognized NPC must return false from slayer_new_target');
    assert.deepEqual(nonMasterTrace.events, [], 'unrecognized NPC dispatch wrote target/count');
    assert.equal(player.getVar(IDS.target), prior.target);
    assert.equal(player.getVar(IDS.count), prior.count);
    assert.equal(gemCount(player), 0);
    results.push({ fixture: 'nonmaster-dispatch', npc: unrecognized[0], success: false, writes: nonMasterTrace.events });

    return { membership, results };
}

function testEveryEndpoint() {
    const results = [];
    const grouped = new Map();
    for (const endpoint of GENERATED_FIXTURES.endpointCases) {
        const groupKey = `${endpoint.master}:${endpoint.fixtureKind}`;
        if (!grouped.has(groupKey)) grouped.set(groupKey, []);
        grouped.get(groupKey).push(endpoint);
    }
    for (const [groupKey, endpoints] of grouped) {
        const [masterKey, fixtureKey] = groupKey.split(':');
        const master = ORACLE.masters.find(entry => entry.key === masterKey);
        const fixture = FIXTURES.get(`${masterKey}:${fixtureKey}`);
        const player = makePlayer();
        applyFixture(player, fixture);
        const npc = makeNpc(IDS.masters[masterKey]);
        assert.equal(combatLevel(player), fixture.combat, `${fixture.key}: endpoint fixture combat mismatch`);
        const acceptance = buildActualValidatorCache(player, npc, fixture, endpoints.map(endpoint => endpoint.target), `${fixture.key}:endpoint`);
        for (const endpoint of endpoints) {
            assert.equal(acceptance.get(endpoint.target), true, `${endpoint.sourceName}: endpoint target rejected by packed validator`);
            for (const side of ['min', 'max']) {
                const desiredRandom = side === 'min' ? 0 : 1 - Number.EPSILON;
                const prior = sentinelTask(player, 123, 456);
                const trace = traceWrites(player);
                const random = withRandomStream([0, desiredRandom], () => runInt(player, '[proc,generate_slayer_task]', npc, [rowForPacked(endpoint.masterName).id]));
                trace.restore();
                const expectedCount = side === 'min' ? endpoint.min : endpoint.max;
                assert.equal(random.result.value, 1, `${endpoint.sourceName}/${side}: singleton compiled selector failed`);
                assert.equal(player.getVar(IDS.target), endpoint.target, `${endpoint.sourceName}/${side}: endpoint target mismatch`);
                assert.equal(player.getVar(IDS.count), expectedCount, `${endpoint.sourceName}/${side}: randominc ${side} endpoint mismatch`);
                assert.equal(expectedRowEligibility({ ...endpoint, target: endpoint.target }, fixture), true, `${endpoint.sourceName}: independent endpoint eligibility failed`);
                assert.equal(acceptance.get(endpoint.target), true, `${endpoint.sourceName}: real validator rejected endpoint target`);
                assert.deepEqual(trace.events.map(event => event.kind), ['target', 'count'], `${endpoint.sourceName}/${side}: write ordering mismatch`);
                assert.equal(gemCount(player), 0, `${endpoint.sourceName}/${side}: direct selector granted a gem`);
                results.push({ master: masterKey, fixture: fixture.key, sourceName: endpoint.sourceName, occurrenceIndex: endpoint.occurrenceIndex, endpoint: side, target: endpoint.target, amount: expectedCount, weight: endpoint.weight, randomValues: random.observed, opcount: random.result.opcount, prior });
            }
        }
    }
    return results;
}

function findBasePackDirectory(basePack) {
    assert(fs.existsSync(basePack), `base pack directory missing: ${basePack}`);
    const server = path.join(basePack, 'server');
    for (const name of ['script.dat', 'script.idx', 'enum.dat', 'dbrow.dat', 'dbrow.idx', 'dbtable.dat']) {
        assert(fs.existsSync(path.join(server, name)), `${basePack} is missing server/${name}`);
    }
    return basePack;
}

function testOldHarpieDiscriminator(basePack) {
    loadRuntime({ scripts: basePack, rows: basePack, configs: basePack });
    const target = Number(ORACLE.constants.get('slayer_harpiebugswarm'));
    const oldSlayerEnum = packedEnum('slayer_req');
    assert.equal(oldSlayerEnum.defaultInt, 0, 'published S1 slayer_req enum missing-key default must be zero');
    assert.equal(oldSlayerEnum.values.has(target), false, 'published S1 slayer_req enum unexpectedly contains a harpie key');
    const oldCombatRequirement = packedEnum('combat_req').values.get(target);
    assert.equal(oldCombatRequirement, 45, 'published S1 combat_req must retain the Harpie combat-45 gate');

    const player = makePlayer();
    const npc = makeNpc(IDS.masters.turael);
    const cases = [
        { key: 'old_cb45_base32', combat: 45, level: 36, baseSlayer: 32, currentSlayer: 99, expected: true },
        { key: 'old_cb40_base32', combat: 40, level: 32, baseSlayer: 32, currentSlayer: 1, expected: false }
    ];
    const observations = [];
    for (const entry of cases) {
        const fixture = { ...entry, questValues: completedQuestValues() };
        applyFixture(player, fixture);
        assert.equal(combatLevel(player), entry.combat, `${entry.key}: old Harpie combat fixture mismatch`);
        const actual = validatorAccepts(player, npc, target);
        assert.equal(actual, entry.expected, `${entry.key}: published S1 validator discriminator mismatch`);
        observations.push({ key: entry.key, combat: entry.combat, baseSlayer: entry.baseSlayer, currentSlayer: entry.currentSlayer, expected: entry.expected, actual });
    }
    const missingThresholds = [];
    for (const [category, requirement] of SOURCED_SLAYER_THRESHOLDS.filter(([category]) => [
        'slayer_caveslime', 'slayer_lizard', 'slayer_harpiebugswarm', 'slayer_feverspider', 'slayer_mutatedzygomite'
    ].includes(category))) {
        const categoryId = Number(ORACLE.constants.get(category));
        assert.equal(oldSlayerEnum.values.has(categoryId), false, `${category}: old pack must reproduce the omitted key`);
        const fixture = { key: `old_${category}_below`, combat: 126, level: 99, baseSlayer: requirement - 1, currentSlayer: 1, questValues: completedQuestValues() };
        applyFixture(player, fixture);
        const accepted = validatorAccepts(player, npc, categoryId);
        assert.equal(accepted, true, `${category}: published missing-key validator must accept N-1 with all other prerequisites fixed`);
        missingThresholds.push({ category, categoryId, sourcedRequirement: requirement, oldRequirement: oldSlayerEnum.defaultInt, baseSlayer: fixture.baseSlayer, currentSlayer: fixture.currentSlayer, oldAccepted: accepted, requiredS2Accepted: false, questSetup: fixture.questValues });
    }
    const missingPredicates = OWNER_PREDICATES.map(owner => {
        const present = Boolean(ScriptProvider.getByName(`[proc,${owner.proc}]`));
        assert.equal(present, false, `${owner.proc}: published pack must lack the extracted owner contract`);
        return { proc: owner.proc, present, requiredS2Present: true };
    });
    console.log(`REPRODUCED S2 old-pack failures ${JSON.stringify({ missingThresholds, missingPredicates })}`);
    return {
        target,
        oldSlayerEnum: { hasHarpieKey: false, defaultInt: oldSlayerEnum.defaultInt },
        combatRequirement: oldCombatRequirement,
        observations,
        missingThresholds,
        missingPredicates
    };
}

function testDeterministicCases() {
    const current = testCurrentSuite();
    const missingListEngineBoundary = testMissingListEngineBoundary(ACTIVE_PACK_DIR);
    loadRuntime({ scripts: FIXTURE_PACK_DIR, rows: FIXTURE_PACK_DIR });
    const adversarial = testAdversarialFixtures();
    const endpoints = testEveryEndpoint();
    const s8 = testS8DialogueCases(ACTIVE_PACK_DIR);
    return { current, missingListEngineBoundary, adversarial, endpoints, s8 };
}
const metadata = {
    assignment: 'U-SLAYERSEL-1113 S3–S8 compiled proof (preserving S1/S2 cases)',
    revision: 377,
    mode: OPTIONS.mode,
    runId: RUN_ID,
    contentRoot: CONTENT_ROOT,
    engineRoot: ENGINE_ROOT,
    activePack: ACTIVE_PACK_DIR,
    basePack: null,
    artifactDirectory: RUN_DIR,
    pins: { content: gitHead(CONTENT_ROOT), engine: gitHead(ENGINE_ROOT) },
    sourceHashes: SOURCE_HASHES,
    masterTablesSha256: digestFile(MASTER_TABLES_FILE),
    compilerInputs: COMPILER_INPUTS,
    compilerFixturePack: FIXTURE_PACK_RESULT,
    fixtureSourceSha256: FIXTURE_SOURCE_HASH,
    fixtures: [...FIXTURES.values()].map(recordFixture),
    sourcedThresholds: SOURCED_SLAYER_THRESHOLDS,
    seeds: SEEDS,
    drawsPerSeed: ACTIVE_DRAWS_PER_SEED,
    family: { categories: 76, B: FAMILY_B, alpha: ALPHA, logBound: LOG_BOUND },
    outOfS1: OUT_OF_S1,
    checks: {}
};

try {
    if (OPTIONS.basePack) {
        const basePack = findBasePackDirectory(OPTIONS.basePack);
        metadata.basePack = {
            requested: OPTIONS.basePack,
            loadedFrom: basePack,
            contentHead: fs.existsSync(path.join(basePack, 'content-head.txt')) ? fs.readFileSync(path.join(basePack, 'content-head.txt'), 'utf8').trim() : null,
            engineHead: fs.existsSync(path.join(basePack, 'engine-head.txt')) ? fs.readFileSync(path.join(basePack, 'engine-head.txt'), 'utf8').trim() : null,
            sha256: hashTree(basePack),
            files: Object.fromEntries(['script.dat', 'script.idx', 'enum.dat', 'dbrow.dat', 'dbrow.idx', 'dbtable.dat']
                .map(name => [name, digestFile(path.join(basePack, 'server', name))]))
        };
    }

    if (OPTIONS.mode === 'full' || OPTIONS.mode === 'ci') {
        const deterministic = testDeterministicCases();
        const current = deterministic.current;
        metadata.checks.current = {
            packedRows: Object.fromEntries([...current.packedRows].map(([name, master]) => [name, { memberOccurrences: master.rows.length }])),
            masterSnapshots: current.masterSnapshots,
            turaelPredicate: current.turaelPredicate,
            d1Bears: current.d1Bears,
            ernest: current.ernest,
            chaeldarRetargets: current.chaeldarRetargets,
            duradelTables: current.duradelTables,
            admission: current.admission,
            harpieThreshold: current.harpieThreshold,
            thresholds: current.thresholds,
            currentStatSource: current.currentStatSource,
            ownerPredicateDispatch: current.ownerPredicateDispatch,
            priestperilAccess: current.priestperilAccess,
            skippyAccess: current.skippyAccess,
            dispatch: current.dispatch,
            emptyMinimumFailures: current.emptyMinimumFailures,
            teaching: current.teaching
        };
        metadata.checks.missingListEngineBoundary = deterministic.missingListEngineBoundary;
        metadata.checks.adversarial = deterministic.adversarial;
        metadata.checks.endpoints = { count: deterministic.endpoints.length, results: deterministic.endpoints };
        metadata.checks.s8 = deterministic.s8;
        metadata.checks.outOfS1 = OUT_OF_S1;

        const distributions = [];
        const allBins = [];
        for (const master of ORACLE.masters) {
            for (const fixtureKind of ['minimum', 'high']) {
                const fixture = FIXTURES.get(`${master.key}:${fixtureKind}`);
                const player = makePlayer();
                applyFixture(player, fixture);
                const npc = makeNpc(IDS.masters[master.key]);
                const acceptance = buildActualValidatorCache(player, npc, fixture, [...ORACLE.taskNamesById.keys(), ...master.rows.map(row => row.target)], `${fixture.key}:distribution`);
                const result = await runDistribution(master, fixture, current.packedRows, acceptance, ACTIVE_DRAWS_PER_SEED);
                distributions.push({ master: master.key, fixture: fixture.key, ...result, bins: undefined });
                allBins.push(...result.bins);
                console.log(`PASS distribution ${master.key}/${fixture.key}: ${result.draws} draws, ${result.outputPath}`);
            }
        }
        const binPath = path.join(RUN_DIR, 'distribution-bins.json');
        fs.writeFileSync(binPath, `${JSON.stringify({
            family: { categories: 76, B: FAMILY_B, alpha: ALPHA, logBound: LOG_BOUND, seeds: SEEDS, drawsPerSeed: ACTIVE_DRAWS_PER_SEED },
            formula: 'abs(observed - N*P) <= ceil(sqrt(2*N*P*(1-P)*ln(2*B/alpha)) + 2*ln(2*B/alpha)/3); P=0 or 1 is exact',
            bins: allBins
        }, null, 2)}\n`);
        metadata.checks.distributions = distributions;
        metadata.checks.binFile = { path: binPath, sha256: digestFile(binPath), binCount: allBins.length };
    } else if (OPTIONS.mode === 'proportional') {
        loadRuntime({ scripts: ACTIVE_PACK_DIR, rows: ACTIVE_PACK_DIR });
        const packedRows = assertPackedLiveRows();
        testMasterSnapshots();
        metadata.checks.proportional = testProportionalRoll(packedRows);
    } else if (OPTIONS.mode === 'adversarial') {
        loadRuntime({ scripts: FIXTURE_PACK_DIR, rows: FIXTURE_PACK_DIR });
        metadata.checks.adversarial = testAdversarialFixtures();
        metadata.checks.endpoints = { count: testEveryEndpoint().length };
    } else if (OPTIONS.mode === 'old-discriminator') {
        const basePack = findBasePackDirectory(OPTIONS.basePack);
        metadata.checks.oldHarpieDiscriminator = testOldHarpieDiscriminator(basePack);
    } else if (OPTIONS.mode === 'table-old-discriminator') {
        metadata.checks.oldTableRepairs = testOldTableRepairs(findBasePackDirectory(OPTIONS.basePack));
    } else if (OPTIONS.mode === 'replacement') {
        const basePack = OPTIONS.basePack ? findBasePackDirectory(OPTIONS.basePack) : findBasePackDirectory(ACTIVE_PACK_DIR);
        metadata.checks.s8 = testS8DialogueCases(basePack, basePack);
    } else if (OPTIONS.mode === 'priestperil') {
        loadRuntime({ scripts: ACTIVE_PACK_DIR, rows: ACTIVE_PACK_DIR });
        assertPackedLiveRows();
        metadata.checks.priestperilAccess = testPriestperilAccess();
    }
    metadata.status = 'PASS';
    metadata.completedAt = new Date().toISOString();
    fs.writeFileSync(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`RESULT PASS ${OPTIONS.mode}; artifacts=${RUN_DIR}; out-of-S1=${OUT_OF_S1.length} boundaries disclosed`);
    // World import starts background workers; this runner is intentionally standalone.
    process.exit(0);
} catch (error) {
    metadata.status = 'FAIL';
    metadata.error = String(error?.stack ?? error);
    metadata.completedAt = new Date().toISOString();
    try {
        fs.writeFileSync(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
    } catch {
        // Preserve the primary failure; no external state is touched by this fallback.
    }
    console.error(error?.stack ?? error);
    process.exit(1);
}
