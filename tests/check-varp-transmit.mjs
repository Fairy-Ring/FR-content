import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function listFiles(root, extension) {
    const files = [];
    function visit(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(file);
            } else if (entry.isFile() && file.endsWith(extension)) {
                files.push(file);
            }
        }
    }
    visit(root);
    return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function relativePath(root, file) {
    return path.relative(root, file).split(path.sep).join('/');
}

function sections(file) {
    const result = [];
    let current;
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('//') || line.startsWith('#')) {
            continue;
        }
        const section = /^\[([^\]]+)\]$/.exec(line);
        if (section) {
            current = { name: section[1], values: new Map() };
            result.push(current);
            continue;
        }
        if (!current) {
            continue;
        }
        const property = /^([^=]+)=(.*)$/.exec(line);
        if (!property) {
            continue;
        }
        const key = property[1].trim().toLowerCase();
        const value = property[2].trim().replace(/\s+\/\/.*$/, '');
        current.values.set(key, value);
    }
    return result;
}

function readExceptions(exceptionsFile) {
    const parsed = JSON.parse(readFileSync(exceptionsFile, 'utf8'));
    if (!Array.isArray(parsed)) {
        throw new Error(`${relativePath(path.dirname(exceptionsFile), exceptionsFile)} must contain an array`);
    }
    return parsed;
}

function scanContent(contentRoot, exceptions) {
    const scriptsRoot = path.join(contentRoot, 'scripts');
    const varps = new Map();
    const varbits = new Map();
    const readers = new Map();
    const issues = [];

    for (const file of listFiles(scriptsRoot, '.varp')) {
        const rel = relativePath(contentRoot, file);
        if (rel.startsWith('scripts/_unpack/')) {
            continue;
        }
        for (const section of sections(file)) {
            varps.set(section.name, {
                file: rel,
                transmit: section.values.get('transmit')?.toLowerCase() === 'yes',
                clientcode: section.values.get('clientcode')
            });
        }
    }

    for (const file of listFiles(scriptsRoot, '.varbit')) {
        for (const section of sections(file)) {
            const basevar = section.values.get('basevar');
            if (basevar) {
                varbits.set(section.name, { basevar, file: relativePath(contentRoot, file) });
            }
        }
    }

    function addReader(varp, evidence) {
        const sources = readers.get(varp) ?? [];
        sources.push(evidence);
        readers.set(varp, sources);
    }
    for (const extension of ['.loc', '.npc']) {
        for (const file of listFiles(scriptsRoot, extension)) {
            const rel = relativePath(contentRoot, file);
            for (const section of sections(file)) {
                const multivar = section.values.get('multivar');
                if (!multivar) {
                    continue;
                }
                // Same order as the packer (LocConfig/NpcConfig): a varp name first, then a varbit.
                const varbit = varps.has(multivar) ? undefined : varbits.get(multivar);
                const varp = varbit?.basevar ?? multivar;
                if (varps.has(varp)) {
                    const source = varbit ? `${multivar} (${varbit.file})` : multivar;
                    addReader(varp, `${rel} [${section.name}] multivar=${source}`);
                }
            }
        }
    }

    for (const [name, varp] of varps) {
        if (varp.clientcode) {
            addReader(name, `${varp.file} clientcode=${varp.clientcode}`);
        }
    }

    for (const file of listFiles(scriptsRoot, '.if')) {
        const rel = relativePath(contentRoot, file);
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
            const operation = /^\s*script\d+op\d+\s*=\s*([^,]+),\s*([^,]+)(?:,|$)/i.exec(lines[index]);
            if (!operation) {
                continue;
            }
            const opcode = operation[1].trim().toLowerCase();
            const operand = operation[2].trim();
            const evidence = `${rel}:${index + 1} ${opcode}`;
            if (opcode === 'pushvar' || opcode === 'testbit') {
                addReader(operand, evidence);
            } else if (opcode === 'push_varbit') {
                const varbit = varbits.get(operand);
                if (varbit) {
                    addReader(varbit.basevar, `${evidence} ${operand} (${varbit.file})`);
                } else {
                    issues.push(`${evidence} references unresolved varbit ${operand}`);
                }
            }
        }
    }

    const exceptionsByName = new Map();
    for (const exception of exceptions) {
        if (!exception || typeof exception !== 'object' || typeof exception.varp !== 'string' || typeof exception.reason !== 'string' || exception.reason.trim().length < 20) {
            issues.push('each exception must have a varp name and a specific reason of at least 20 characters');
            continue;
        }
        if (exceptionsByName.has(exception.varp)) {
            issues.push(`duplicate exception for ${exception.varp}`);
            continue;
        }
        exceptionsByName.set(exception.varp, exception.reason.trim());
    }

    for (const [name, varp] of varps) {
        if (!varp.transmit) {
            continue;
        }
        const evidence = readers.get(name);
        const exception = exceptionsByName.get(name);
        if (evidence?.length) {
            if (exception) {
                issues.push(`${name} has client reader evidence and an unnecessary exception (${exception})`);
            }
        } else if (!exception) {
            issues.push(`${name} (${varp.file}) has transmit=yes but no 377 client reader or documented exception`);
        }
    }

    for (const name of exceptionsByName.keys()) {
        const varp = varps.get(name);
        if (!varp?.transmit) {
            issues.push(`exception for ${name} does not match an authored transmit=yes varp`);
        }
    }

    return {
        issues,
        transmitted: [...varps.entries()].filter(([, varp]) => varp.transmit).map(([name]) => name),
        readerCount: [...varps.entries()].filter(([name, varp]) => varp.transmit && readers.has(name)).length,
        exceptionCount: exceptionsByName.size
    };
}

function selfTest() {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'varp-transmit-'));
    const scripts = path.join(fixture, 'scripts');
    mkdirSync(path.join(scripts, 'fixtures'), { recursive: true });
    mkdirSync(path.join(scripts, 'interfaces'), { recursive: true });
    writeFileSync(path.join(scripts, 'fixtures', 'fixture.varp'), [
        '[clientcode_reader]', 'transmit=yes', 'clientcode=7', '',
        '[direct_reader]', 'transmit=yes', '',
        '[varbit_reader]', 'transmit=yes', '',
        '[loc_multivar_reader]', 'transmit=yes', '',
        '[npc_multivar_reader]', 'transmit=yes', '',
        '[unread_varp]', 'transmit=yes', ''
    ].join('\n'));
    writeFileSync(path.join(scripts, 'fixtures', 'fixture.varbit'), '[fixture_bit]\nbasevar=varbit_reader\n');
    writeFileSync(path.join(scripts, 'fixtures', 'fixture_loc.loc'), [
        '[loc_varbit_multi]', 'multivar=fixture_bit', '',
        '[loc_direct_multi]', 'multivar=loc_multivar_reader'
    ].join('\n'));
    writeFileSync(path.join(scripts, 'fixtures', 'fixture_npc.npc'), [
        '[npc_direct_multi]', 'multivar=npc_multivar_reader'
    ].join('\n'));
    writeFileSync(path.join(scripts, 'interfaces', 'fixture.if'), [
        'script1op1=pushvar,direct_reader',
        'script1op2=testbit,direct_reader,0',
        'script1op3=push_varbit,fixture_bit'
    ].join('\n'));

    try {
        const unclassified = scanContent(fixture, []);
        assert.equal(unclassified.issues.length, 1, JSON.stringify(unclassified.issues));
        assert.match(unclassified.issues[0], /unread_varp/);
        assert.equal(unclassified.readerCount, 5);

        const classified = scanContent(fixture, [{
            varp: 'unread_varp',
            reason: 'Fixture exception represents a documented non-interface client use.'
        }]);
        assert.deepEqual(classified.issues, []);
        assert.equal(classified.transmitted.length, 6);
        assert.equal(classified.readerCount, 5);
        assert.equal(classified.exceptionCount, 1);

        const unnecessary = scanContent(fixture, [{
            varp: 'loc_multivar_reader',
            reason: 'Fixture exception represents a documented non-interface client use.'
        }]);
        assert(unnecessary.issues.some(issue => issue.includes('unnecessary exception')));
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
}

selfTest();

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exceptions = readExceptions(path.join(contentRoot, '.github', 'varp-transmit-exceptions.json'));
const result = scanContent(contentRoot, exceptions);
if (result.issues.length) {
    console.error('Transmitted varp client-reader guard failed:');
    for (const issue of result.issues) {
        console.error(`- ${issue}`);
    }
    process.exitCode = 1;
} else {
    console.log(`Classified ${result.transmitted.length} transmitted varps: ${result.readerCount} have 377 client reader evidence and ${result.exceptionCount} have documented exceptions.`);
}
