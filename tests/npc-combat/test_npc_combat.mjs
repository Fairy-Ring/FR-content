#!/usr/bin/env node
/** Exact native-pack assertions, followed by temporary-file checker self-tests. No server or vault access. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkManifest, loadPack } from './packed.mjs';
import { runSelfTests } from './self_test.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.resolve(testDir, '../..');
const engineDir = path.resolve(process.env.HARNESS_ENGINE_DIR ?? path.join(contentDir, '../engine'));
const options = {
    '--pack': process.env.HARNESS_PACK_DIR ?? path.join(engineDir, 'data/pack'),
    '--manifest': path.join(testDir, 'built-vectors.json'),
    '--snapshots': path.join(testDir, 'snapshots.json'),
    '--report': null, '--snapshot': null, '--snapshot-commit': null
};
let result;
function printLevels(levels) {
    for (const level of levels) console.log(`LEVEL ${level.npc}: formula=${level.formula} cache=${level.visible} ${level.status}${level.exception ? ` reason=${level.exception.reason}` : ''}`);
}
function writeReport(reportData) {
    if (!options['--report']) return;
    const report = path.resolve(options['--report']);
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `${JSON.stringify(reportData, null, 2)}\n`);
}
try {
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i];
        if (!Object.hasOwn(options, key) || !process.argv[i + 1]) throw new Error(`Unknown or incomplete argument: ${key}`);
        options[key] = process.argv[i + 1];
    }
    const pack = await loadPack(contentDir, engineDir, path.resolve(options['--pack']));
    if (options['--snapshot']) {
        const npc = pack.NpcType.getByName(options['--snapshot']);
        if (!npc) throw new Error(`[missing-type] missing packed NPC ${options['--snapshot']}`);
        console.log(JSON.stringify(pack.capture({ debugname: npc.debugname, id: npc.id }, options['--snapshot-commit']), null, 2));
    } else {
        if (options['--snapshot-commit']) throw new Error('--snapshot-commit requires --snapshot');
        const readJson = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
        result = await checkManifest(readJson(options['--manifest']), readJson(options['--snapshots']), pack);
        printLevels(result.levels);
        result.selfTests = await runSelfTests(pack, process.env.RUNNER_TEMP ?? os.tmpdir());
        writeReport({ status: 'PASS', ...result });
        console.log(`npc-combat: ${result.entries} built entries, ${result.fields} fields, ${result.routes} routes; ${result.selfTests} self-tests PASS`);
    }
} catch (error) {
    const levels = error.levels ?? result?.levels ?? [];
    printLevels(error.levels ?? []);
    writeReport({ ...result, status: 'FAIL', error: error.message, levels });
    console.error(`npc-combat FAIL: ${error.message}`);
    process.exitCode = 1;
}

// Native runtime imports retain background handles, as in the other offline interpreter tests.
process.exit(process.exitCode ?? 0);
