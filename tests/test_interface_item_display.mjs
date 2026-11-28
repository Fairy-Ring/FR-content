import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const contentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptsRoot = resolve(contentRoot, 'scripts');
const interfacesRoot = resolve(scriptsRoot, 'interfaces');

// Verified exceptions where the item's native 2dzoom (1500..2000) is designed for a high scale divisor.
const HIGH_SCALE_ALLOWLIST = new Set([
  'scripts/macro events/scripts/general/macro_event_strange_box.rs2:macro_cube:center_shape_model:390',
  'scripts/macro events/scripts/general/macro_event_strange_box.rs2:macro_cube:center_number_model:390',
  'scripts/macro events/scripts/general/macro_event_strange_box.rs2:macro_cube:side_shape_model:390',
  'scripts/macro events/scripts/general/macro_event_strange_box.rs2:macro_cube:side_number_model:390',
  'scripts/macro events/scripts/general/macro_event_strange_box.rs2:macro_cube:top_shape_model:390',
  'scripts/macro events/scripts/general/macro_event_strange_box.rs2:macro_cube:top_number_model:390',
]);

function sourceFiles(directory, extension) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(file, extension));
    else if (entry.isFile() && file.endsWith(extension)) files.push(file);
  }
  return files;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function splitTopLevelArgs(argString) {
  const args = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = 0; i < argString.length; i++) {
    const ch = argString[i];
    if (ch === '"' && argString[i - 1] !== '\\') {
      inString = !inString;
      current += ch;
    } else if (!inString) {
      if (ch === '(') {
        depth++;
        current += ch;
      } else if (ch === ')') {
        depth--;
        current += ch;
      } else if (ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) args.push(current.trim());
  return args;
}

function animatedInterfaces() {
  const animated = new Map();
  for (const file of sourceFiles(interfacesRoot, '.if')) {
    const ifName = basename(file, '.if');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const anims = [];
    let currentCom = null;
    for (const line of lines) {
      const sec = /^\s*\[([^\]]+)\]/.exec(line);
      if (sec) {
        currentCom = sec[1];
        continue;
      }
      const anim = /^\s*(?:anim|activeanim)\s*=\s*(\S+)/.exec(line);
      if (anim && currentCom) anims.push(`${currentCom}:${anim[1]}`);
    }
    if (anims.length > 0) animated.set(ifName, anims);
  }
  return animated;
}

test('if_setobject numeric scales stay below 300 unless explicitly allowlisted', () => {
  const failures = [];
  for (const file of sourceFiles(scriptsRoot, '.rs2')) {
    const rel = relative(contentRoot, file);
    const cleaned = stripComments(readFileSync(file, 'utf8'));
    const lines = cleaned.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const m of line.matchAll(/\.?if_setobject\s*\(([^;]+)\)/g)) {
        const args = splitTopLevelArgs(m[1]);
        if (args.length < 3) continue;
        const [com, , scaleExpr] = args;
        if (!/^\d+$/.test(scaleExpr)) continue;
        const scale = Number(scaleExpr);
        const key = `${rel}:${com}:${scale}`;
        if (scale >= 300 && !HIGH_SCALE_ALLOWLIST.has(key)) {
          failures.push(`${rel}:${i + 1} if_setobject(${com}, ..., ${scale}) — scale is a percentage divisor (zoom = zoom2d*100/scale), not a camera zoom`);
        }
      }
    }
  }
  assert.deepEqual(failures, [], `Oversized if_setobject scales found:\n${failures.join('\n')}`);
});

test('tut_open never opens an interface with model animations (Java 377 skips sticky chat anims)', () => {
  const animated = animatedInterfaces();
  const failures = [];
  for (const file of sourceFiles(scriptsRoot, '.rs2')) {
    const rel = relative(contentRoot, file);
    const cleaned = stripComments(readFileSync(file, 'utf8'));
    const lines = cleaned.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(/\btut_open\s*\(\s*([a-zA-Z0-9_]+)\s*\)/g)) {
        const ifName = m[1];
        if (animated.has(ifName)) {
          failures.push(`${rel}:${i + 1} tut_open(${ifName}) freezes animations: ${animated.get(ifName).join(', ')}`);
        }
      }
    }
  }
  assert.deepEqual(failures, [], `Animated interfaces opened via tut_open:\n${failures.join('\n')}`);
});
