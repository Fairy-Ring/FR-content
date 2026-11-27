import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const contentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptsRoot = resolve(contentRoot, 'scripts');
const callPattern = /~\s*\.?\s*(chatnpc_specific|chatnpcrange|chatnpcnoturn|chatplayer|chatnpc)(?![\w])\s*\(/g;
const animationPattern = /^<p,([^>]+)>/;
const noAnimationComment = /\bno[\s_-]*(?:anim|animation)\b/i;

function sourceFiles(directory, extension) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(file, extension));
    else if (entry.isFile() && file.endsWith(extension)) files.push(file);
  }
  return files;
}

function configuredAnimations() {
  const names = new Set();
  for (const file of sourceFiles(scriptsRoot, '.mesanim')) {
    const source = readFileSync(file, 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const section = /^\s*\[([^\]]+)\]/.exec(line);
      if (section) names.add(section[1]);
    }
  }
  return names;
}

function codeMask(source) {
  const visible = source.split('');
  let inString = false;
  let escaped = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index++) {
    if (inBlockComment) {
      if (source[index] !== '\n' && source[index] !== '\r') visible[index] = ' ';
      if (source.startsWith('*/', index)) {
        if (index + 1 < source.length) visible[index + 1] = ' ';
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      if (source[index] !== '\n' && source[index] !== '\r') visible[index] = ' ';
      if (escaped) escaped = false;
      else if (source[index] === '\\') escaped = true;
      else if (source[index] === '"') inString = false;
      continue;
    }

    if (source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
        visible[index++] = ' ';
      }
      index--;
    } else if (source.startsWith('/*', index)) {
      visible[index] = ' ';
      if (index + 1 < source.length) visible[index + 1] = ' ';
      inBlockComment = true;
      index++;
    } else if (source[index] === '"') {
      visible[index] = ' ';
      inString = true;
    }
  }

  return visible.join('');
}

function argumentRange(source, openingParenthesis, wantedArgument) {
  let start = openingParenthesis + 1;
  let argument = 0;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  let inString = false;
  let escaped = false;
  let inBlockComment = false;

  for (let index = start; index < source.length; index++) {
    if (inBlockComment) {
      if (source.startsWith('*/', index)) {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (source[index] === '\\') escaped = true;
      else if (source[index] === '"') inString = false;
      continue;
    }

    if (source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n') index++;
      continue;
    }
    if (source.startsWith('/*', index)) {
      inBlockComment = true;
      index++;
      continue;
    }

    const character = source[index];
    if (character === '"') inString = true;
    else if (character === '(') parentheses++;
    else if (character === ')') {
      if (parentheses === 0 && brackets === 0 && braces === 0) {
        return argument === wantedArgument ? { start, end: index } : null;
      }
      parentheses--;
    } else if (character === '[') brackets++;
    else if (character === ']') brackets--;
    else if (character === '{') braces++;
    else if (character === '}') braces--;
    else if (character === ',' && parentheses === 0 && brackets === 0 && braces === 0) {
      if (argument === wantedArgument) return { start, end: index };
      argument++;
      start = index + 1;
    }
  }

  return null;
}

function literalArgument(source, range) {
  if (!range) return null;
  const raw = source.slice(range.start, range.end).trimStart();
  if (!raw.startsWith('"')) return null;

  let escaped = false;
  for (let index = 1; index < raw.length; index++) {
    if (escaped) escaped = false;
    else if (raw[index] === '\\') escaped = true;
    else if (raw[index] === '"') return raw.slice(1, index);
  }
  return raw.slice(1);
}

function lineAt(source, offset) {
  const start = source.lastIndexOf('\n', offset) + 1;
  let end = source.indexOf('\n', offset);
  if (end < 0) end = source.length;
  return { start, text: source.slice(start, end) };
}

function dynamicProcedureReturns(name, files) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(`^\\s*\\[proc,\\s*${escapedName}\\s*\\]`, 'm');
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const match = declaration.exec(source);
    if (!match) continue;

    const bodyStart = match.index;
    const nextDeclaration = /\n\s*\[[^\]\r\n]+\]/g;
    nextDeclaration.lastIndex = bodyStart + match[0].length;
    const next = nextDeclaration.exec(source);
    const body = source.slice(bodyStart, next ? next.index : source.length);
    return [...body.matchAll(/\breturn\s*\(?\s*"([^"]*)"/g)].map(result => result[1]);
  }
  return [];
}

test('chathead dialogue literals use configured mesanims', () => {
  const validAnimations = configuredAnimations();
  assert.ok(validAnimations.size > 0, 'no .mesanim sections were found');

  const files = sourceFiles(scriptsRoot, '.rs2');
  const dynamicHelpers = new Set();
  const problems = [];
  let literalCalls = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const visible = codeMask(source);
    for (const match of visible.matchAll(callPattern)) {
      const name = match[1];
      const openingParenthesis = match.index + match[0].lastIndexOf('(');
      const messageArgument = name === 'chatnpc_specific' ? 2 : 0;
      const value = literalArgument(source, argumentRange(source, openingParenthesis, messageArgument));
      if (value === null) continue;
      literalCalls++;

      const location = `${relative(contentRoot, file)}:${lineAt(source, match.index).text}`;
      if (value.startsWith('<p,')) {
        const animation = animationPattern.exec(value);
        if (!animation) problems.push(`${location}: malformed <p,...> prefix`);
        else if (!validAnimations.has(animation[1])) problems.push(`${location}: unknown mesanim ${animation[1]}`);
      } else if (value.startsWith('<~')) {
        const dynamic = /^<~([A-Za-z0-9_]+)>/.exec(value);
        if (!dynamic) problems.push(`${location}: malformed dynamic mesanim prefix`);
        else dynamicHelpers.add(dynamic[1]);
      } else if (!noAnimationComment.test(lineAt(source, match.index).text)) {
        problems.push(`${location}: missing <p,<mesanim>> prefix`);
      }
    }
  }

  assert.ok(literalCalls > 0, 'no literal chathead dialogue calls were found');
  for (const helper of dynamicHelpers) {
    const returns = dynamicProcedureReturns(helper, files);
    if (returns.length === 0) {
      problems.push(`dynamic prefix ${helper} has no literal string returns`);
      continue;
    }
    for (const value of returns) {
      const animation = animationPattern.exec(value);
      if (!animation) problems.push(`dynamic prefix ${helper} returns a string without <p,...>`);
      else if (!validAnimations.has(animation[1])) problems.push(`dynamic prefix ${helper} returns unknown mesanim ${animation[1]}`);
    }
  }

  if (problems.length > 0) {
    const preview = problems.slice(0, 12).join('\n');
    assert.fail(`Found ${problems.length} chathead animation issue(s):\n${preview}`);
  }
});
