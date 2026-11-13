#!/usr/bin/env node
/** Report direct switch_int(random(...)) tables. Dynamic bounds stay explicit. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Preserve offsets and line numbers while excluding strings and comments.
function mask(source) {
    return source.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, text => text.replace(/[^\n]/g, ' '));
}

function closeAt(code, start, open, close) {
    let depth = 0;
    for (let i = start; i < code.length; i++) {
        if (code[i] === open) depth++;
        if (code[i] === close && --depth === 0) return i;
    }
    throw new Error(`Unclosed ${open} at offset ${start}`);
}

export function scanSource(source, file) {
    const code = mask(source);
    const lineAt = offset => source.slice(0, offset).split('\n').length;
    const tables = [];
    for (const match of code.matchAll(/\bswitch_int\s*\(\s*random\s*\(/g)) {
        const randomOpen = match.index + match[0].lastIndexOf('(');
        const randomClose = closeAt(code, randomOpen, '(', ')');
        const tail = /^\s*\)\s*\{/.exec(code.slice(randomClose + 1));
        if (!tail) continue; // Not a direct random selector, for example random(n) + 1.
        const open = randomClose + tail[0].length;
        const close = closeAt(code, open, '{', '}');
        const boundExpression = code.slice(randomOpen + 1, randomClose).trim();
        const bound = /^\d+$/.test(boundExpression) ? Number(boundExpression) : null;
        const branches = [];
        let depth = 0;
        for (let i = open + 1; i < close; i++) {
            if (code[i] === '{') depth++;
            if (code[i] === '}') depth--;
            if (depth !== 0 || !/^case\b/.test(code.slice(i)) || /\w/.test(code[i - 1])) continue;
            const colon = code.indexOf(':', i);
            assert(colon !== -1 && colon < close, `${file}:${lineAt(i)}: case without colon`);
            const labels = code.slice(i + 4, colon).split(',').map(label => label.trim());
            branches.push({ index: branches.length, line: lineAt(i), start: i, bodyStart: colon + 1, labels });
            i = colon;
        }
        for (let i = 0; i < branches.length; i++) {
            branches[i].end = branches[i + 1]?.start ?? close;
            branches[i].endLine = lineAt(branches[i].end);
        }
        const labels = branches.flatMap(branch => branch.labels);
        const numeric = labels.filter(label => /^-?\d+$/.test(label)).map(Number);
        const duplicates = [...new Set(labels.filter((label, i) => labels.indexOf(label) !== i))];
        const unknownLabels = labels.filter(label => label !== 'default' && !/^-?\d+$/.test(label));
        const hasDefault = labels.includes('default');
        const missing = bound === null || unknownLabels.length ? null : Array.from({ length: bound }, (_, i) => i).filter(i => !numeric.includes(i));
        const outOfRange = bound === null ? null : numeric.filter(value => value < 0 || value >= bound);
        tables.push({ file, line: lineAt(match.index), boundExpression, bound, branches, labels, duplicates, outOfRange, missing, hasDefault, unknownLabels });
    }
    return tables;
}

export function scanTree(root = CONTENT_ROOT) {
    const result = [];
    function visit(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(full);
            else if (entry.isFile() && entry.name.endsWith('.rs2')) {
                result.push(...scanSource(fs.readFileSync(full, 'utf8'), path.relative(root, full).split(path.sep).join('/')));
            }
        }
    }
    visit(path.join(root, 'scripts'));
    return result;
}

export function printReport(tables) {
    for (const table of tables) {
        console.log(JSON.stringify({
            file: table.file, line: table.line, bound: table.bound ?? table.boundExpression,
            labels: table.labels, duplicates: table.duplicates, outOfRange: table.outOfRange,
            missing: table.missing, hasDefault: table.hasDefault, unknownLabels: table.unknownLabels,
            unmatchedRolls: table.hasDefault ? [] : table.missing
        }));
    }
    console.log(`REPORT ${tables.length} direct random switches (non-failing census, dynamic bounds are unresolved)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) printReport(scanTree());
