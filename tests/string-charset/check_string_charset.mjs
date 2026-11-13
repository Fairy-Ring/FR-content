#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// U-CHARSET-1113 facts.md: printable ASCII, plus £ from Client-Java 377's
// published WordPack alphabet (entry 55). The 377 unpack text census has no
// non-ASCII values. This is NOT a promise for UTF-8-default Java runtimes.
const ALLOWED_NON_ASCII = new Set(['£']);
const scriptExtensions = new Set(['.rs2', '.constant', '.opt']);
const configTextKeys = new Map([
  ['.obj', /^(?:name|desc|i?op[1-5])$/],
  ['.npc', /^(?:name|desc|op[1-5])$/],
  ['.loc', /^(?:name|desc|op[1-5])$/],
  // PackShared.ts writes these as client pjstr values. tooltip is also guarded
  // as a text-field spelling, although this packer uses option for button tips.
  // graphic/activegraphic and slotN sprite names are transmitted strings too.
  ['.if', /^(?:text|activetext|option[1-5]?|tooltip|action|actionverb|graphic|activegraphic|slot(?:[1-9]|1[0-9]|20))$/],
  ['.flo', /$^/], // FloConfig.ts sends the section name, not a key=value field.
]);
const stringTag = /^(?:<(?:br|col|str|shad|u|img|gt|lt)(?:=[^<>]+)?>|<\/(?:br|col|str|shad|u|img|gt|lt)>|<(?:br|col|str|shad|u|img|gt|lt)=|<p,[^<>]+>)/;

/** Find unsupported literal characters without executing or compiling content. */
export function detectUnsupportedCharacters(text, file) {
  const errors = [];
  const check = (character, line) => {
    const codePoint = character.codePointAt(0);
    if ((codePoint < 0x20 || codePoint > 0x7e) && !ALLOWED_NON_ASCII.has(character)) {
      errors.push({ file, line, codePoint, character });
    }
  };
  const extension = path.extname(file);
  if (configTextKeys.has(extension)) {
    // Active config reader: tools/pack/config/PackShared.ts:217-261.
    // Values are raw, including quotes and inline //, not script literals.
    // Interface NameMap.loadDir likewise does not remove inline comments.
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line.startsWith('//')) continue;
      if (extension === '.flo' && line.startsWith('[') && line.endsWith(']')) {
        const name = line.slice(1, -1);
        if (!name.startsWith('flo_')) for (const char of name) check(char, index + 1);
      }
      const separator = line.indexOf('=');
      if (separator !== -1 && configTextKeys.get(extension).test(line.slice(0, separator))) {
        for (const char of line.slice(separator + 1)) check(char, index + 1);
      }
    }
    return errors;
  }
  if (!scriptExtensions.has(extension)) return errors;

  // @lostcityrs/runescript 0.9.7-fr.1, dist/runescript.js:34:
  // RuneScriptLexer.g4's generated String/default modes and lexer actions.
  // The package exports only compiler/check-session APIs, not its lexer.
  // Block comments end at the FIRST */. Only \\, \" and \< are string escapes.
  // Newlines are lexical errors, but recovery keeps the current string mode.
  const modes = ['code'];
  let offset = 0;
  let line = 1;
  const consume = (end, literal = false) => {
    while (offset < end) {
      const char = String.fromCodePoint(text.codePointAt(offset));
      if (literal) check(char, line);
      if (char === '\n') line++;
      offset += char.length;
    }
  };
  while (offset < text.length) {
    const char = text[offset];
    if (modes.at(-1) === 'string') {
      if (char === '"') {
        modes.pop();
        consume(offset + 1);
      } else if (char === '\\') {
        // No \u or \x decoding. Unknown escapes are compiler errors.
        const next = text[offset + 1];
        consume(offset + 1);
        if (next !== undefined) consume(offset + String.fromCodePoint(text.codePointAt(offset)).length, true);
      } else if (char === '<') {
        const tag = stringTag.exec(text.slice(offset));
        if (tag) consume(offset + tag[0].length, true);
        else {
          modes.push('code');
          consume(offset + 1);
        }
      } else {
        consume(offset + String.fromCodePoint(text.codePointAt(offset)).length, char !== '\r' && char !== '\n');
      }
    } else if (text.startsWith('//', offset)) {
      const end = text.indexOf('\n', offset + 2);
      consume(end === -1 ? text.length : end);
    } else if (text.startsWith('/*', offset)) {
      const end = text.indexOf('*/', offset + 2);
      consume(end === -1 ? text.length : end + 2);
    } else if (char === '"') {
      modes.push('string');
      consume(offset + 1);
    } else if (char === "'") {
      // CHAR_LITERAL is an integer expression, not a string. Its quote or
      // less-than character must not change the surrounding lexer mode.
      const literal = /^'(?:\\[\\']|[^'\\\r\n])'/u.exec(text.slice(offset));
      consume(offset + (literal ? literal[0].length : 1));
    } else if (text.startsWith('>=', offset)) {
      consume(offset + 2); // GTE wins over GT; it does not end interpolation.
    } else if (char === '>' && modes.length > 1) {
      modes.pop();
      consume(offset + 1);
    } else {
      consume(offset + String.fromCodePoint(text.codePointAt(offset)).length);
    }
  }
  return errors;
}

export function scanContent(contentRoot) {
  const errors = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isDirectory() && entry.name === '_unpack') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (scriptExtensions.has(path.extname(file)) || configTextKeys.has(path.extname(file))) {
        errors.push(...detectUnsupportedCharacters(fs.readFileSync(file, 'utf8'), path.relative(contentRoot, file)));
      }
    }
  }
  walk(path.join(contentRoot, 'scripts'));
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const errors = scanContent(path.resolve(process.argv[2] ?? process.cwd()));
  if (errors.length > 0) {
    console.error(`Unsupported Client-Java 377 text characters (${errors.length}):`);
    for (const { file, line, codePoint, character } of errors) {
      console.error(`${file}:${line}: U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(character)}`);
    }
    process.exitCode = 1;
  }
}
