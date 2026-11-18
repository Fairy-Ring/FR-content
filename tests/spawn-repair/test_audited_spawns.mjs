#!/usr/bin/env node
/** Source-only guard. The main spawn-repair test also runs this before checking the full pack. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(HERE, '../..');
const audited = [];
const maps = new Map();
for (const [index, line] of fs.readFileSync(path.join(HERE, 'audited-spawns.txt'), 'utf8').split(/\r?\n/).entries()) {
    if (!line || line.startsWith('#')) continue;
    const match = /^(-?)(m\d+_\d+\.jm2)\|(NPC|OBJ)\|(\d+) (\d+) (\d+): (\d+) (\d+) # (.+)$/.exec(line);
    assert(match, `Invalid audited-spawns.txt:${index + 1}: ${line}`);
    const [, absent, file, section, level, x, z, id, qty] = match;
    const record = `${section}|${level} ${x} ${z}: ${id} ${qty}`;
    audited.push({ absent: absent === '-', file, record, line: index + 1 });
    if (!maps.has(file)) maps.set(file, new Map());
}
assert(audited.length > 0, 'The audited spawn list must not be empty');

for (const [file, rows] of maps) {
    let section = '';
    for (const [index, line] of fs.readFileSync(path.join(CONTENT, 'maps', file), 'utf8').split(/\r?\n/).entries()) {
        const heading = /^==== (\w+) ====$/.exec(line);
        if (heading) { section = heading[1]; continue; }
        if (!['NPC', 'OBJ'].includes(section) || !line) continue;
        const match = /^(\d+) (\d+) (\d+): (\d+)(?: (\d+))?$/.exec(line);
        assert(match, `Invalid spawn row ${file}:${index + 1}: ${line}`);
        const [, level, x, z, id, qty] = match;
        const record = `${section}|${level} ${x} ${z}: ${id} ${section === 'NPC' ? 1 : qty}`;
        rows.set(record, (rows.get(record) ?? 0) + 1);
    }
}

const failures = [];
for (const { absent, file, record, line } of audited) {
    const rows = maps.get(file);
    const count = rows.get(record) ?? 0;
    const label = `audited maps/${file}|${record} (audited-spawns.txt:${line})`;
    if (absent) {
        if (count !== 0) failures.push(`${label}: deliberately removed row returned`);
    } else if (count === 0) {
        failures.push(`${label}: missing or changed audited row`);
    } else {
        // Consume one occurrence, not every row at this tile. Additional spawns are allowed.
        rows.set(record, count - 1);
    }
}
assert.equal(failures.length, 0, failures.join('\n'));
console.log(`PASS audited spawn rows: ${audited.length} individual audit entries; additional spawns allowed`);
