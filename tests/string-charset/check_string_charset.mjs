#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const contentRoot = path.resolve(process.argv[2] ?? process.cwd());
const clientTextExtensions = new Set([
  '.rs2', '.obj', '.npc', '.loc', '.if', '.dbrow', '.opt', '.constant',
  '.varp', '.varbit', '.param', '.enum', '.dbtable', '.vars', '.varn',
  '.inv', '.hunt', '.mesanim', '.seq', '.spotanim', '.struct', '.pack',
]);
const errors = [];

function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  let inString = false;
  let escaped = false;
  let line = 1;
  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    const char = String.fromCodePoint(codePoint);
    if (char === '\n') {
      line++;
      inString = false;
      escaped = false;
      offset += char.length;
      continue;
    }
    if (!inString && char === '/' && text[offset + 1] === '/') {
      while (offset < text.length && text[offset] !== '\n') offset++;
      continue;
    }
    if (inString && codePoint > 0xff) {
      errors.push(`${path.relative(contentRoot, file)}:${line}: U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(char)}`);
    }
    if (char === '"' && !escaped) inString = !inString;
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    offset += char.length;
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === '_unpack') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (clientTextExtensions.has(path.extname(entry.name))) scanFile(file);
  }
}

walk(path.join(contentRoot, 'scripts'));
if (errors.length > 0) {
  console.error(`Unsupported Client-Java 377 text characters (${errors.length}):`);
  for (const error of errors) console.error(error);
  process.exitCode = 1;
}
