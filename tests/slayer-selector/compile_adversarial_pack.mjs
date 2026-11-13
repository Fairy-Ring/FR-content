#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

function arg(name) {
    const index = process.argv.indexOf(name);
    if (index < 0 || index + 1 >= process.argv.length) {
        throw new Error(`Missing ${name} <value>`);
    }
    return process.argv[index + 1];
}

function digestFile(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
const FIXTURE_MODES = new Set(['standard', 'replacement-empty-turael']);

function validPack(directory, sourceKey, fixtureMode) {
    const manifestPath = path.join(directory, 'fixture-pack.json');
    if (!fs.existsSync(manifestPath)) {
        return false;
    }

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.sourceKey !== sourceKey || manifest.fixtureMode !== fixtureMode) {
            return false;
        }
        for (const name of ['script.dat', 'script.idx', 'dbrow.dat', 'dbrow.idx']) {
            const file = path.join(directory, 'server', name);
            if (!fs.existsSync(file) || fs.statSync(file).size === 0 || manifest.files[name] !== digestFile(file)) {
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

function replaceTuraelTableInTemporarySource(masterRowsFile, fixtureSource) {
    const source = fs.readFileSync(masterRowsFile, 'utf8');
    const lines = source.split(/\r?\n/);
    const headers = lines.flatMap((line, index) => line.trim() === '[turael_task_table]' ? [index] : []);
    if (headers.length !== 1) {
        throw new Error(`Expected exactly one temporary [turael_task_table] stanza, found ${headers.length}`);
    }

    const start = headers[0];
    let end = start + 1;
    while (end < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[end])) end++;

    const adversarialSource = fs.readFileSync(fixtureSource, 'utf8');
    const children = ['s1_selector_dagannoth', 's1_selector_elf'];
    for (const name of children) {
        const matches = adversarialSource.match(new RegExp(`^\\[${name}\\]$`, 'gm')) ?? [];
        if (matches.length !== 1) throw new Error(`Expected existing adversarial row [${name}] exactly once`);
    }

    lines.splice(start, end - start,
        '[turael_task_table]',
        'table=slayer_task_table',
        ...children.map(name => `data=task,${name}`),
        ''
    );
    const replacement = lines.join('\n');
    if ((replacement.match(/^\[turael_task_table\]$/gm) ?? []).length !== 1) {
        throw new Error('Temporary Turael table replacement created a duplicate configuration name');
    }
    fs.writeFileSync(masterRowsFile, replacement);
    return {
        table: 'turael_task_table',
        children,
        sourceSha256: digestFile(masterRowsFile)
    };
}


function chooseOutput(outputBase, sourceKey, fixtureMode) {
    const parent = path.dirname(outputBase);
    const prefix = `${path.basename(outputBase)}-`;
    if (fs.existsSync(parent)) {
        const candidates = fs.readdirSync(parent)
            .filter(name => name === path.basename(outputBase) || name.startsWith(prefix))
            .sort()
            .map(name => path.join(parent, name));
        for (const candidate of candidates) {
            if (validPack(candidate, sourceKey, fixtureMode)) {
                return { directory: candidate, reused: true };
            }
        }
    }

    if (!fs.existsSync(outputBase)) {
        return { directory: outputBase, reused: false };
    }

    return {
        directory: `${outputBase}-${Date.now()}-${process.pid}`,
        reused: false
    };
}

async function importEngineFile(engineRoot, relative) {
    return import(pathToFileURL(path.join(engineRoot, relative)).href);
}

async function main() {
    const contentRoot = path.resolve(arg('--content'));
    const engineRoot = path.resolve(arg('--engine'));
    const fixtureSource = path.resolve(arg('--fixture'));
    const outputBase = path.resolve(arg('--output-dir'));
    const sourceKey = arg('--source-key');
    const fixtureMode = process.argv.includes('--fixture-mode') ? arg('--fixture-mode') : 'standard';
    if (!FIXTURE_MODES.has(fixtureMode)) throw new Error(`Unsupported --fixture-mode ${fixtureMode}`);
    const output = chooseOutput(outputBase, sourceKey, fixtureMode);

    if (output.reused) {
        const manifest = JSON.parse(fs.readFileSync(path.join(output.directory, 'fixture-pack.json'), 'utf8'));
        console.log(JSON.stringify({
            ...output,
            sourceKey,
            fixtureMode,
            temporaryTableOverride: manifest.temporaryTableOverride ?? null,
            files: manifest.files,
            compilerPackageVersion: manifest.compilerPackageVersion,
            compiled: false
        }));
        return;
    }

    const workspaceParent = path.dirname(outputBase);
    fs.mkdirSync(workspaceParent, { recursive: true });
    const tempRoot = fs.mkdtempSync(path.join(workspaceParent, '.workspace-'));
    const tempContent = path.join(tempRoot, 'content');
    const tempEngine = path.join(tempRoot, 'engine');
    const tempScripts = path.join(tempContent, 'scripts');
    const tempFixture = path.join(tempScripts, 'skill_slayer', 'configs', 's1_selector_adversarial.dbrow');
    const temporaryMasterRows = path.join(tempScripts, 'skill_slayer', 'configs', 'slayer_master_tasks.dbrow');
    let originalCwd = process.cwd();
    let temporaryTableOverride = null;

    try {
        fs.mkdirSync(tempContent, { recursive: true });
        fs.mkdirSync(tempEngine, { recursive: true });
        fs.cpSync(path.join(contentRoot, 'scripts'), tempScripts, { recursive: true, preserveTimestamps: true });
        fs.cpSync(path.join(contentRoot, 'pack'), path.join(tempContent, 'pack'), { recursive: true, preserveTimestamps: true });
        fs.copyFileSync(fixtureSource, tempFixture);
        if (fixtureMode === 'replacement-empty-turael') {
            temporaryTableOverride = replaceTuraelTableInTemporarySource(temporaryMasterRows, fixtureSource);
        }
        fs.cpSync(path.join(engineRoot, 'data', 'pack'), path.join(tempEngine, 'data', 'pack'), { recursive: true, preserveTimestamps: true });

        const serverPack = path.join(tempEngine, 'data', 'pack', 'server');
        for (const name of ['script.dat', 'script.idx']) {
            fs.rmSync(path.join(serverPack, name), { force: true });
        }
        fs.mkdirSync(path.join(tempEngine, 'data', 'pack', 'client'), { recursive: true });

        process.env.BUILD_SRC_DIR = tempContent;
        process.env.BUILD_VERIFY = 'false';
        process.chdir(tempEngine);

        const packShared = await importEngineFile(engineRoot, 'tools/pack/config/PackShared.ts');
        const dbRowConfig = await importEngineFile(engineRoot, 'tools/pack/config/DbRowConfig.ts');
        const dbTableTypeModule = await importEngineFile(engineRoot, 'src/cache/config/DbTableType.ts');
        const { default: DbTableType } = dbTableTypeModule;

        packShared.loadConstants();
        const { PackFile } = await importEngineFile(engineRoot, 'tools/pack/PackFileBase.ts');
        const packFiles = await importEngineFile(engineRoot, 'tools/pack/PackFile.ts');
        for (const pack of Object.values(packFiles)) {
            if (pack instanceof PackFile) pack.load(path.join(tempContent, 'pack', `${pack.type}.pack`));
        }
        packFiles.DbRowPack.reload();
        DbTableType.load('data/pack');

        const tree = new Set();
        packShared.readDirTree(tree, tempScripts);
        await packShared.readConfigs(
            tree,
            '.dbrow',
            [],
            [],
            dbRowConfig.parseDbRowConfig,
            dbRowConfig.packDbRowConfigs,
            (dat, idx) => {
                dat.release();
                idx.release();
            },
            (dat, idx) => {
                dat.save('data/pack/server/dbrow.dat');
                idx.save('data/pack/server/dbrow.idx');
                dat.release();
                idx.release();
            }
        );

        const { runServerCompiler } = await importEngineFile(engineRoot, 'tools/pack/Compiler.ts');
        await runServerCompiler();

        fs.mkdirSync(path.join(output.directory, 'server'), { recursive: true });
        const names = ['script.dat', 'script.idx', 'dbrow.dat', 'dbrow.idx'];
        for (const name of names) {
            const source = path.join(serverPack, name);
            if (!fs.existsSync(source) || fs.statSync(source).size === 0) {
                throw new Error(`Compiler did not produce nonempty ${source}`);
            }
            fs.copyFileSync(source, path.join(output.directory, 'server', name));
        }

        const manifest = {
            format: 'slayer-selector-fixture-pack-v1',
            sourceKey,
            fixtureMode,
            temporaryTableOverride,
            compiledAt: new Date().toISOString(),
            compilerEntry: 'engine/tools/pack/Compiler.ts:runServerCompiler',
            compilerPackageVersion: JSON.parse(fs.readFileSync(path.join(engineRoot, 'node_modules/@lostcityrs/runescript/package.json'), 'utf8')).version,
            fixtureSource: path.relative(contentRoot, fixtureSource),
            files: Object.fromEntries(names.map(name => [name, digestFile(path.join(output.directory, 'server', name))]))
        };
        fs.writeFileSync(path.join(output.directory, 'fixture-pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(JSON.stringify({ ...output, sourceKey, fixtureMode, temporaryTableOverride, compiled: true, files: manifest.files, compilerPackageVersion: manifest.compilerPackageVersion }));
    } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
});
