import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => fs.readFileSync(path.join(contentRoot, relative), 'utf8');
const questSource = read('scripts/general/scripts/quests.rs2');
export const constants = new Map();
const scripts = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith('.constant')) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/^\^(\w+)\s*=\s*(-?\d+)\s*$/gm)) {
        assert(!constants.has(match[1]), `duplicate constant ${match[1]}`);
        constants.set(match[1], Number(match[2]));
      }
    } else if (entry.name.endsWith('.rs2')) scripts.push(file);
  }
}
visit(path.join(contentRoot, 'scripts'));
export function value(name) {
  assert(constants.has(name), `missing numeric constant ^${name}`);
  return constants.get(name);
}
const lineAt = offset => questSource.slice(0, offset).split('\n').length;
const counterStart = questSource.indexOf('[proc,count_questpoints]');
const listStart = questSource.indexOf('[proc,update_questlist]');
export const blocks = [...questSource.slice(counterStart, listStart).matchAll(/if \((.*?)\) \{[^{}]*?\$questpoints = add\(\$questpoints, \^(\w+)\);[^{}]*?\}/gs)].map(match => ({
  condition: match[1], pointsConstant: match[2], line: lineAt(counterStart + match.index)
}));

function argumentsOf(text) {
  const args = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}
const colours = [...questSource.slice(listStart).matchAll(/~send_quest_progress_colour\((.*)\);/g)].map(match => {
  const [component, progress, complete] = argumentsOf(match[1]);
  return { component: component.replace('questlist:', ''), progress, complete, line: lineAt(listStart + match.index) };
}).filter(row => row.progress !== '1'); // Underground Pass's started-bit display, not its completion row.

function pointsForColour(row) {
  const complete = row.complete.match(/\^(\w+)/)?.[1];
  assert(complete, `unrecognised colour completion ${row.complete}`);
  // These are existing naming differences, not a second quest/reward inventory.
  const stem = ({ quest_cog_complete: 'cog', mortton_quest_complete: 'mortton', ikov_completed_armadyl: 'ikov', phoenixgang_complete: 'blackarmgang' })[complete]
    ?? complete.replace(/_complete$/, '');
  return `${stem}_questpoints`;
}

function progressFixture(progress, terminal) {
  const direct = progress.match(/^%(\w+)$/);
  if (direct) return [[direct[1], terminal]];
  const proc = progress.match(/^~(\w+)$/);
  assert(proc, `unsupported progress fixture ${progress}`);
  for (const file of scripts) {
    const body = fs.readFileSync(file, 'utf8').split(`[proc,${proc[1]}]`)[1]?.split('\n[')[0];
    if (!body) continue;
    const bits = body.match(/return\s*\(getbit_range\(%(\w+), 0, 3\)\);/);
    assert(bits, `unsupported computed progress fixture ${progress}`);
    return [[bits[1], terminal]];
  }
  throw new Error(`missing computed progress ${progress}`);
}
function colourFixture(row) {
  const constant = row.complete.match(/\^(\w+)/)[1];
  const terminal = row.complete.startsWith('sub(pow(2,') ? 2 ** value(constant) - 1 : value(constant);
  return progressFixture(row.progress, terminal);
}
function blockFixture(block) {
  const bit = block.condition.match(/^testbit\(%(\w+), \^(\w+)\) = \^true$/);
  if (bit) return [[bit[1], 2 ** value(bit[2])]];
  const direct = block.condition.match(/^(%\w+|~\w+) (?:=|>=) \^(\w+)$/);
  assert(direct, `unsupported counter fixture ${block.condition}`);
  return progressFixture(direct[1], value(direct[2]));
}

export const quests = [];
export const withoutPoints = [];
const used = new Set();
for (const match of read('scripts/interfaces/questlist.if').matchAll(/^\[([^\]]+)\]\n(.*?)(?=^\[|(?![\s\S]))/gms)) {
  if (!/^option=/m.test(match[2])) continue;
  const component = match[1];
  const name = match[2].match(/^text=(.*)$/m)?.[1];
  assert(name, `quest component ${component} has no title`);
  const colourRows = colours.filter(row => row.component === component);
  const pointsConstant = colourRows.length ? pointsForColour(colourRows[0]) : `${component}_questpoints`;
  if (!constants.has(pointsConstant)) {
    withoutPoints.push({ component, name });
    continue;
  }
  assert(!used.has(pointsConstant), `reward constant shared by quest rows: ${pointsConstant}`);
  used.add(pointsConstant);
  const countRows = blocks.filter(block => block.pointsConstant === pointsConstant);
  assert(colourRows.length || countRows.length, `${name}: no colour or count fixture mapping`);
  // Where login has no colour call, the existing counter supplies the fixture only.
  // The vault facts cross-check these stage/operator mappings in the unit report.
  const fixture = colourRows.length ? colourFixture(colourRows[0]) : blockFixture(countRows[0]);
  quests.push({ component, name, pointsConstant, points: value(pointsConstant), colours: colourRows, blocks: countRows, fixture });
}
export const orphanPoints = [...constants.keys()].filter(name => name.endsWith('_questpoints') && !name.includes('_required_') && !used.has(name));
export const registrySum = quests.reduce((sum, quest) => sum + quest.points, 0);
