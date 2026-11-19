/** Compiled native Inspect dispatch and read-only message matrix. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { World, types, id, inv, player, load } from './runtime.mjs';

const { default: Scripts } = await load('engine/script/ScriptProvider.ts');
const { default: Trigger } = await load('engine/script/ServerTriggerType.ts');
const { default: OpLoc } = await load('network/game/client/model/OpLoc.ts');
const handler = new ((await load('network/game/client/handler/OpLocHandler.ts')).default)();
const map = await load('engine/GameMap.ts');
const p = player();
let observeWrites = false;
const writes = [];
for (const method of ['setVar', 'setVarBit', 'playAnimation']) {
  const original = p[method];
  p[method] = function (...args) {
    if (observeWrites) writes.push([method, ...args]);
    return original.apply(this, args);
  };
}
const inspect = Scripts.getByName('[label,farming_inspect]');
assert(inspect, 'compiled shared Inspect handler exists (fails on the parent pack)');
const forms = new Set();
const expected = JSON.parse(fs.readFileSync(new URL('./inspect-messages.json', import.meta.url), 'utf8'));
const left = new Map();
const deadForms = new Set();
let cases = 0;
let treatedCases = 0;
const supportedVisible = new Set();
for (const family of expected.families) {
  for (const name of family.parents) {
    const root = types.LocType.get(id('LocType', name));
    for (const { from, to } of family.states) {
      for (let stage = from; stage <= to; stage++) {
        const visible = types.LocType.get(root.multiloc[stage]);
        if (visible.op?.[1] === 'Inspect') supportedVisible.add(visible.debugname);
      }
    }
  }
}

// The allowlist is independent of product data and of the wording workbook.
const confirmed = [
  'This is an allotment.', 'This is a herb patch.', 'This is a flower patch.', 'This is a hops patch.',
  'The soil has not been treated.', 'The soil has been treated with compost.',
  'The soil has been treated with supercompost.', 'The patch needs weeding.',
  'The patch is empty and weeded.', 'The patch has something growing in it.',
  'The patch is fully grown.', 'Your scarecrow is protecting these crops from disease.',
  'The patch is diseased and needs attending to.',
  'This is a bush patch.', 'This is a tree patch.', 'This is a fruit tree patch.',
  'This is a cactus patch.', 'This is a belladonna patch.', 'This is a mushroom patch.',
  'This is a calquat patch.', 'This is a spirit tree patch.',
];

// Read p12_full from this tree's built client/title, not retained metrics.
// FontType applies the same edge-column/space advances as PixFont.
// 377 draws type-0 text at x=4 and clips glyph columns at x >= 462.
const font = types.FontType.get(1);
assert(font?.charMaskWidth[65] > 0, 'the built p12_full font is loaded');
const measuredMessages = new Map();
function rightPixel(text) {
  let x = 4, end = x;
  for (const character of text) {
    const code = character.charCodeAt(0);
    assert(code < 256, 'Inspect text uses supported font characters');
    if (character !== ' ') end = x + font.charOffsetX[code] + font.charMaskWidth[code];
    x += font.charAdvance[code];
  }
  return end;
}
assert.equal(rightPixel('The patch has something growing in it.'), 216, 'reviewer metric calibration: growing sentence');
assert.equal(rightPixel(expected.scarecrow), 316, 'reviewer metric calibration: scarecrow sentence');
function assertFits(message) {
  const end = rightPixel(message);
  assert(end <= 462, `Inspect message fits the 377 chat line: end=${end}, limit=462: ${message}`);
  measuredMessages.set(message, end);
}
for (const sentence of confirmed) assertFits(sentence);
function assertConfirmed(messages) {
  for (const message of messages) {
    const sentences = message.match(/[^.!?]+[.!?]/g)?.map(line => line.trim()) ?? [];
    assert.equal(sentences.join(' '), message, 'no unparsed or placeholder text');
    assert.equal(sentences.length, 1, 'exactly one sentence per game message');
    assertFits(message);
    for (const sentence of sentences) assert(confirmed.includes(sentence), 'sentence is on independently confirmed allowlist: ' + sentence);
  }
}
assert.deepEqual(new Set(expected.confirmedSentences), new Set(confirmed));
const workbook = JSON.parse(fs.readFileSync(new URL('./inspect-text-rows.json', import.meta.url), 'utf8'));
const tupleKeys = new Set();
for (const row of workbook.rows) {
  const key = [row.patchFamily, row.soilTreatment, row.state, row.lineRole].join('/');
  assert(!tupleKeys.has(key), 'wordbook row keys are unique'); tupleKeys.add(key);
  if (!expected.patchTypes[row.patchFamily]) {
    assert.equal(row.text, '', 'unbuilt-family wording remains empty');
    assert.equal(row.approvedFor377, false); continue;
  }
  const text = row.lineRole === 'patch-type' ? expected.patchTypes[row.patchFamily]
    : row.lineRole === 'soil-treatment' ? expected.soils[row.soilTreatment]
    : row.lineRole === 'growth-state' ? (expected.stateSentences[row.state] ?? '') : expected.scarecrow;
  assert.equal(row.text, text, key);
  assert.equal(row.approvedFor377, Boolean(text), key);
  if (text) assert(confirmed.includes(text), key);
}
// All three retained wording treatments now have native dispatch coverage.
assert.deepEqual(Object.keys(expected.soils).sort(), ['compost', 'supercompost', 'untreated']);
for (const family of expected.families.filter(family => family.built)) {
  const kinds = new Set(family.states.map(state => state.kind));
  for (const soil of Object.keys(expected.soils)) for (const state of kinds) {
    for (const role of ['patch-type', 'soil-treatment', 'growth-state']) {
      assert(tupleKeys.has([family.key, soil, state, role].join('/')), 'every exact-key wording slot exists');
    }
  }
}

const content = path.resolve(import.meta.dirname, '../..');
const placements = new Map(expected.families.flatMap(family => family.parents.map(name => [name, []])));
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mapX, mapZ] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match) continue;
    const [level, x, z, type] = match.slice(1, 5).map(Number);
    const config = types.LocType.get(type);
    if (!placements.has(config.debugname)) continue;
    const loc = World.getLoc(mapX * 64 + x, mapZ * 64 + z, level, type);
    if (loc) placements.get(config.debugname).push(loc);
  }
}
function approach(name) {
  for (const loc of placements.get(name)) {
    const config = types.LocType.get(loc.type);
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = loc.x + dx, z = loc.z + dz;
      if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z, loc.x, loc.z,
        config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) return { loc, x, z };
    }
  }
  assert.fail(`${name}: original packed placement has no valid adjacent test stand`);
}
function snapshot() {
  return {
    vars: Array.from(p.vars), xp: Array.from(p.stats), levels: Array.from(p.levels),
    baseLevels: Array.from(p.baseLevels),
    inventory: Array.from({ length: types.InvType.get(inv).size }, (_, slot) => {
      const item = p.invGetSlot(inv, slot);
      return item ? { id: item.id, count: item.count } : null;
    }),
    animation: p.animId, delay: p.delayedUntil,
  };
}
const soilFields = {
  allotment: { varp: 'varp513_bits', bit: 0 },
  hops: { varp: 'varp513_bits', bit: 16 },
  flower: { varp: 'varp513_bits', bit: 24 },
  herb: { varp: 'varp516_bits', bit: 24 },
};
const treatedCaseCount = 2 * expected.families.filter(family => family.built).reduce((total, family) =>
  total + family.parents.length * family.states.reduce((count, { from, to }) => count + to - from + 1, 0), 0);
{
  for (const family of expected.families) {
    for (const [patchIndex, name] of family.parents.entries()) {
      const root = types.LocType.get(id('LocType', name));
      const selector = types.VarBitType.get(root.multivarbit);
      assert(selector || family.states.length === 0, `${name}: original packed selector`);
      const range = selector ? 2 ** (selector.endbit - selector.startbit + 1) : root.multiloc.length;
      const stand = family.states.length ? approach(name) : null;
      for (let stage = 0; stage < range; stage++) {
        const visibleId = root.multiloc?.[stage];
        if (visibleId == null || visibleId < 0) continue;
        const visible = types.LocType.get(visibleId);
        if (visible.op?.[1] !== 'Inspect') continue;
        const state = family.states.find(state => stage >= state.from && stage <= state.to);
        const lines = state ? family.messages[state.kind] : null;
        const script = Scripts.getByTrigger(Trigger.OPLOC2, visibleId, visible.category);
        if (!lines) {
          if (supportedVisible.has(visible.debugname)) continue; // Original alias to another family's normal empty form.
          // Other units may later implement these forms; never pin their dispatch.
          if (!script) deadForms.add(visible.debugname);
          const group = family.owner ?? family.key;
          const entries = left.get(group) ?? new Set();
          entries.add(visible.debugname); left.set(group, entries);
          continue;
        }
        assert(script, `${name}/${stage}/${visible.debugname}: actual visible-form dispatch exists`);
        assert(script.name.startsWith('[oploc2,'), 'only the requested option is bound');
        const soils = family.built ? ['untreated', 'compost', 'supercompost'] : ['untreated'];
        for (const [treatment, soil] of soils.entries()) {
          p.vars.fill(0);
          p.setVarBit(root.multivarbit, stage);
          if (treatment !== 0) {
            const field = soilFields[family.key];
            p.setVar(id('VarPlayerType', field.varp), (treatment * 2 ** (field.bit + patchIndex * 2)) | 0);
          }
          p.messages.length = 0;
          const { loc, x, z } = stand;
          p.x = p.originX = x; p.z = p.originZ = z; p.level = loc.level;
          p.clearInteraction();
          const before = snapshot();
          writes.length = 0;
          observeWrites = true;
          assert.equal(handler.handle(new OpLoc(2, loc.x, loc.z, root.id), p), true, `${name}/${stage}: native packet admitted`);
          assert.equal(p.getApTrigger(), null, 'Inspect has no added approach script');
          assert.equal(p.getOpTrigger(), script, 'engine dispatch agrees with the visible-form lookup');
          p.processInteraction();
          observeWrites = false;
          assert.deepEqual(writes, [], 'Inspect calls no variable writer or animation command');
          const soilLines = lines.map(line => line === expected.soils.untreated ? expected.soils[soil] : line);
          assert.deepEqual(p.messages, soilLines, `${name}/${stage}/${visible.debugname}/${soil}: retained source lines in exact order`);
          assert.deepEqual(snapshot(), before, `${name}/${stage}: no state, item, XP, animation or delay write`);
          assert.equal(p.activeScript, null, 'Inspect never suspends');
          assert.equal(p.delayed, false, 'Inspect adds no player delay');
          assert.equal(p.hasInteraction(), false, 'Inspect leaves no repeating action');
          assertConfirmed(p.messages);
          assert.equal(p.messages.length, state.kind === 'dead' ? 2 : 3, 'only dead state wording is absent');
          forms.add(visible.debugname);
          if (treatment === 0) cases++;
          else treatedCases++;
        }
      }
    }
  }
}
assert.equal(cases, expected.nativeCases, 'every supported root/state reaches native dispatch');
assert.equal(treatedCases, treatedCaseCount, 'every built root/state has both treated soil message lists');
console.log('PASS Inspect treated soil: ' + treatedCases + ' native root/state/treatment cases; untreated matrix unchanged');
assert.equal(forms.size, expected.supportedForms, 'complete supported visible-form census');
for (const [owner, count] of Object.entries(expected.leftForms)) {
  assert.equal(left.get(owner)?.size ?? 0, count, `${owner}: explicit remaining form count`);
}

let protectionCases = 0;
for (const [patchIndex, name] of expected.families[0].parents.entries()) {
  const root = types.LocType.get(id('LocType', name));
  const { loc, x, z } = approach(name);
  // Exact published pairing: each flower byte serves two allotments.
  const bit = Math.floor(patchIndex / 2) * 8;
  for (const flower of [0, 12, 17, 22, 33, 34, 35, 36]) {
    for (const stage of [34, 35, 39, 40, 52, 53, 59, 60, 98, 103, 116, 163, 227]) {
      const kind = expected.families[0].states.find(state => stage >= state.from && stage <= state.to).kind;
      p.vars.fill(0); p.setVarBit(root.multivarbit, stage);
      p.setVar(id('VarPlayerType', 'farming_flower_varp'), flower * 2 ** bit);
      // A neighbouring flower for a different pair must not supply protection.
      const otherBit = bit === 0 ? 8 : 0;
      if (flower === 0) p.setVar(id('VarPlayerType', 'farming_flower_varp'), 36 * 2 ** otherBit);
      p.x = p.originX = x; p.z = p.originZ = z; p.level = loc.level;
      p.clearInteraction(); p.messages.length = 0; writes.length = 0;
      const before = snapshot(); observeWrites = true;
      assert.equal(handler.handle(new OpLoc(2, loc.x, loc.z, root.id), p), true);
      p.processInteraction(); observeWrites = false;
      const protectedCrop = flower >= 33 && flower <= 36 && stage < 128 && stage % 64 >= 34 && stage % 64 < 40;
      assert.deepEqual(p.messages, [...expected.families[0].messages[kind], ...(protectedCrop ? [expected.scarecrow] : [])], name + '/' + stage + '/flower' + flower);
      assertConfirmed(p.messages); assert.deepEqual(writes, []); assert.deepEqual(snapshot(), before);
      protectionCases++;
    }
  }
}
console.log('PASS Inspect protection: ' + protectionCases + ' native neighbour/crop cases; no watermelon inference');
console.log('INSPECT_CENSUS built=' + forms.size + ' outside_unit=' + [...left.values()].reduce((n, forms) => n + forms.size, 0) + ' currently_dead=' + deadForms.size);

// The handler is option-specific. Every exact entry is confined to the oracle's
// supported forms, so this unit cannot add dispatch to another loc or option.
const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../scripts/skill_farming/scripts/farming_inspect.rs2'), 'utf8');
const bindings = [...source.matchAll(/^\[oploc(\d+),([^\]]+)\]/gm)];
assert.equal(bindings.length, forms.size, 'one exact binding for each supported form');
for (const [, option, name] of bindings) {
  assert.equal(option, '2'); assert(forms.has(name), `${name}: no unrelated dispatch binding`);
}
console.log(`PASS Inspect: ${cases} native root/state cases, ${forms.size} visible forms, exact sourced message order and no state writes`);
console.log(`PASS Inspect width: ${measuredMessages.size} sentences measured from built p12_full; max_end=${Math.max(...measuredMessages.values())}; limit=462`);
for (const [owner, entries] of left) console.log(`LEFT ${owner}: ${entries.size} unplantable crop forms`);
console.log('RESULT PASS Farming Inspect');
process.exit(0);
