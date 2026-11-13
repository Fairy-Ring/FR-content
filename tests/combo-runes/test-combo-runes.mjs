#!/usr/bin/env node
// Run from the sibling engine after its full pack: node --import tsx ../content/tests/combo-runes/test-combo-runes.mjs
// No server starts. The server side executes the packed production RuneScript, not a JS translation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = process.env.HARNESS_ENGINE_DIR ?? path.resolve(HERE, '../../../engine');
const PACK = path.join(ENGINE, 'data/pack');
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'client-377.json'), 'utf8'));
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex < 0 ? null : process.argv[reportIndex + 1];
assert.equal(fixture.source.sha256, '88e882e48de5d2e7c4a103fae5f46db149ccfc88b327b4f6f0d287b36e7ba441');
assert.equal(fixture.buttons.length, 122);
assert.equal(fixture.buttons.filter(c => c.button === 2).length, 65);
process.env.NODE_MEMBERS = 'true';
process.env.NODE_XPRATE = '1';
process.env.NODE_RANDOM_EVENTS = 'false';

const load = async rel => (await import(pathToFileURL(path.join(ENGINE, rel)).href)).default;
const World = await load('src/engine/World.ts');
const Environment = await load('src/util/Environment.ts');
const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
const ScriptState = await load('src/engine/script/ScriptState.ts');
const Player = await load('src/engine/entity/Player.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'MesanimType', 'DbTableType', 'DbRowType', 'FontType', 'Component']) {
  types[name] = await load(`src/cache/config/${name}.ts`);
  types[name].load(PACK);
}
const DbTableIndex = await load('src/cache/config/DbTableIndex.ts');
DbTableIndex.init();
assert(ScriptProvider.load(PACK) > 0, 'build the full content pack first');
World.currentTick = 10;
const { DbRowType, DbTableType, InvType, ObjType } = types;
const table = DbTableType.getByName('magic_spell_table');
const rows = DbRowType.getInTable(table.id);
assert(rows.length > 0);
const column = name => {
  const index = table.columnNames.indexOf(name);
  assert(index >= 0, `missing spell column ${name}`);
  return index;
};
const runeColumn = column('runesrequired');
const staffTable = DbTableType.getByName('magic_staff_table');
const staffColumn = staffTable.columnNames.indexOf('staff');
const staffRuneColumn = staffTable.columnNames.indexOf('rune');
const staffSupplies = new Map();
for (const row of DbRowType.getInTable(staffTable.id)) {
  for (const id of row.columnValues[staffColumn]) {
    if (!staffSupplies.has(id)) staffSupplies.set(id, new Set());
    staffSupplies.get(id).add(row.getValue(staffRuneColumn, 0)[0]);
  }
}
const staves = [null, ...staffSupplies.keys()];
const elements = new Set([554, 555, 556, 557]);
const combinations = [4694, 4695, 4696, 4697, 4698, 4699];
const combinationPriority = [4694, 4697, 4695, 4696, 4699, 4698];
const accepts = new Map();
for (const button of fixture.buttons) {
  for (const req of button.requirements) {
    if (!accepts.has(req.rune)) accepts.set(req.rune, new Set());
    for (const id of req.inventory) accepts.get(req.rune).add(id);
  }
}
const primaryBarrage = fixture.buttons.find(c => c.id === 12891);
const autocastBarrage = fixture.buttons.find(c => c.id === 13136);
// These are contradictory original scripts, not an exception in the gameplay resolver.
assert.deepEqual(primaryBarrage.requirements.find(r => r.rune === 555), {
  rune: 555, count: 6, inventory: [555, 4694, 4695, 4698], staves: [1383, 1395, 1403, 6562, 6563]
});
assert.deepEqual(autocastBarrage.requirements.find(r => r.rune === 555), {
  rune: 555, count: 6, inventory: [555], staves: []
});
assert.deepEqual(primaryBarrage.scriptOffsets[2], [263847, 263903]);
assert.deepEqual(autocastBarrage.scriptOffsets[2], [587317, 587325]);
assert.deepEqual(autocastBarrage.scripts[2], [4, 3214, 555, 0]);
assert.deepEqual(primaryBarrage.scripts[2], [4, 3214, 555, 4, 3214, 4694, 4, 3214, 4695, 4, 3214, 4698, 10, 1688, 1383, 10, 1688, 1395, 10, 1688, 1403, 10, 1688, 6562, 10, 1688, 6563, 0]);

const p = new Player('combo_runes_offline', 1n, 0n);
p.pid = p.uid = 1;
p.levels.fill(99);
p.baseLevels.fill(99);
p.write = () => {};
let messages = [];
p.messageGame = p.wrappedMessageGame = message => messages.push(message);
const inv = p.getInventory(InvType.getId('inv'));
const worn = p.getInventory(InvType.getId('worn'));
assert(inv && worn);
const snapshot = inventory => Object.fromEntries(inventory.itemsFiltered.map(i => [i.id, i.count]).sort((a, b) => a[0] - b[0]));
function seed(inventory, equipment = []) {
  inv.removeAll();
  worn.removeAll();
  messages = [];
  for (const [id, count] of inventory) if (count > 0) assert.equal(inv.add(id, count), count);
  for (const id of equipment) {
    const slot = ObjType.get(id).wearpos;
    assert(slot >= 0, `not wearable: ${id}`);
    assert.equal(worn.get(slot), null, `conflicting equipment slot ${slot}`);
    worn.set(slot, { id, count: 1 });
  }
}
function run(name, row) {
  const script = ScriptProvider.getByName(`[proc,${name}]`);
  assert(script, `missing compiled production proc ${name}`);
  const state = ScriptRunner.init(script, p, null, [row.id]);
  const result = p.runScript(state, true, true);
  assert.equal(result, ScriptState.FINISHED, `${name} aborted or suspended: ${messages.join(' | ')}`);
  return state;
}
const check = row => run('check_spell_requirements', row).popInt() === 1;
const pay = row => run('delete_spell_runes', row);

// Direct translation of the *client* VM, kept independent of the server payment code.
function clientProgram(script, inventory, equipment) {
  let pos = 0;
  let value = 0;
  while (pos < script.length) {
    const op = script[pos++];
    if (op === 0) return value;
    if (op === 1) {
      pos++;
      value += 99;
    } else if (op === 4 || op === 10) {
      const component = script[pos++];
      const id = script[pos++];
      assert(component === 3214 || component === 1688);
      assert(fixture.objects[id], `missing original object ${id}`);
      value += component === 3214 ? (inventory.get(id) ?? 0) : equipment.includes(id) ? (op === 10 ? 999999999 : 1) : 0;
    } else assert.fail(`unsupported original spell CS1 opcode ${op}`);
  }
  assert.fail('unterminated CS1 program');
}
function client(button, inventory, equipment) {
  return button.comparisons.every(([cmp, operand], index) => {
    assert.equal(cmp, 3);
    return clientProgram(button.scripts[index], inventory, equipment) > operand;
  });
}
function baseInventory(requirements) {
  return new Map(requirements.map(r => [r.rune, r.count]));
}
function equipmentFor(required, staff) {
  const equipment = required.map(([id]) => id);
  if (staff !== null && !equipment.includes(staff)) {
    if (equipment.some(id => ObjType.get(id).wearpos === ObjType.get(staff).wearpos)) return null;
    equipment.push(staff);
  }
  return equipment;
}
function* tableCases(button) {
  const exact = baseInventory(button.requirements);
  for (const req of button.items) exact.set(req.rune, req.count);
  const allCombos = inventory => {
    const out = new Map(inventory);
    for (const id of elements) out.delete(id);
    for (const id of combinations) out.set(id, 50);
    return out;
  };
  yield ['plain-only', exact, null];
  yield ['combination-only-all-six', allCombos(exact), null];
  for (const req of button.requirements) {
    const less = new Map(exact);
    less.set(req.rune, req.count - 1);
    yield [`insufficient-${req.rune}`, less, null];
  }
  for (const combo of combinations) {
    const only = new Map(exact);
    for (const id of elements) only.delete(id);
    only.set(combo, 50);
    yield [`only-${combo}`, only, null];
    const both = new Map(exact);
    both.set(combo, 50);
    yield [`both-${combo}`, both, null];
    for (const req of button.requirements.filter(r => elements.has(r.rune))) {
      const partial = new Map(exact);
      partial.set(req.rune, req.count - 1);
      partial.set(combo, 1);
      yield [`partial-${req.rune}-${combo}`, partial, null];
    }
  }
  for (const staff of staves.slice(1)) {
    yield [`staff-plain-${staff}`, exact, staff];
    yield [`staff-combination-${staff}`, allCombos(exact), staff];
  }
  let random = button.id;
  const ids = [...new Set(button.requirements.flatMap(r => r.inventory))];
  for (let trial = 0; trial < 48; trial++) {
    const mixed = new Map(exact);
    for (const id of ids) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      mixed.set(id, random % 8);
    }
    yield [`mixed-${trial}`, mixed, staves[trial % staves.length]];
  }
}

const report = {
  source: fixture.source, buttons: 122, targeted: 65, other: 57, tableCases: 0,
  cacheExpectedDisagreements: 0, mismatches: 0, affectedButtons: [], examples: [],
  existingRows: rows.length, paymentCases: 0, mixedPaymentCases: 0, alchemyCases: 0,
  unchangedPlainStaffCases: 0, optimizedBothCases: 0, plainStaffFailures: 0,
  oracleCases: 0, minimumSpendComparisons: 0, minimumSpendUnits: 0, productionSpendUnits: 0,
  maxDistinctElementalTypes: 0, maxDistinctElementalRows: [],
  faqFireBlastCases: 0, membersRestrictionCases: 0, freeWorldAlchemyCases: 0, failures: []
};
const affected = new Set();
function expect(condition, description, plainStaff = false) {
  if (!condition) {
    report.mismatches++;
    if (plainStaff) report.plainStaffFailures++;
    report.failures.push(description);
  }
}
const probe = rows[0];
const savedColumns = probe.columnValues;
const savedTypes = probe.types;
try {
  probe.types = table.types;
  probe.columnValues = table.types.map(() => []);
  probe.columnValues[column('members')] = [0];
  probe.columnValues[column('levelrequired')] = [1];
  for (const button of fixture.buttons) {
    for (const [name, inventory, staff] of tableCases(button)) {
      const equipment = equipmentFor(button.worn, staff);
      if (equipment === null) continue;
      seed(inventory, equipment);
      const before = snapshot(inv);
      // The current schema has three pairs; AND separate real resolver calls covers
      // every cache requirement, including four-type Ancient spells absent from the pack.
      const serverAnswers = button.requirements.map(req => {
        probe.columnValues[runeColumn] = [req.rune, req.count, -1, -1, -1, -1];
        return check(probe);
      });
      const server = serverAnswers.every(Boolean);
      const displayed = client(button, inventory, equipment);
      assert.deepEqual(snapshot(inv), before, 'requirement checks must not spend runes');
      report.tableCases++;
      if (button.id === 13136 && displayed !== client(primaryBarrage, inventory, equipment)) {
        report.cacheExpectedDisagreements++;
        expect(server === client(primaryBarrage, inventory, equipment), `13136/12891 cache inconsistency changed in ${name}`);
      } else if (server !== displayed) {
        report.mismatches++;
        affected.add(button.id);
        if (report.examples.length < 12) report.examples.push({ button: button.id, name, client: displayed, server, inventory: Object.fromEntries(inventory), equipment });
      }
    }
  }
} finally {
  probe.columnValues = savedColumns;
  probe.types = savedTypes;
}

function rowRequirements(row) {
  const tuple = row.getValue(runeColumn, 0);
  const requirements = [];
  for (let i = 0; i < tuple.length; i += 2) if (tuple[i] >= 0 && tuple[i + 1] > 0) requirements.push({ rune: tuple[i], count: tuple[i + 1] });
  return requirements;
}
function rowEquipment(row, staff) {
  const id = row.getValue(column('wornrequired'), 0)[0];
  return equipmentFor(id < 0 ? [] : [[id, 1]], staff);
}
function debit(expected) {
  const actual = new Map(Object.entries(snapshot(inv)).map(([id, count]) => [Number(id), count]));
  for (const [id, count] of expected) if (count === 0) expected.delete(id);
  return JSON.stringify([...actual].sort((a, b) => a[0] - b[0])) === JSON.stringify([...expected].sort((a, b) => a[0] - b[0]));
}
// This brute-force oracle uses only the cache acceptance sets and physical inventory counts.
function expectedPayment(requirements, inventory) {
  const demandByRune = new Map();
  for (const { rune, count } of requirements) demandByRune.set(rune, (demandByRune.get(rune) ?? 0) + count);
  const demands = [...demandByRune].map(([rune, count]) => ({ rune, count }));
  const sources = demands.map(({ rune }) => {
    const accepted = accepts.get(rune);
    assert(accepted?.has(rune), `cache acceptance set is missing plain rune ${rune}`);
    return accepted;
  });
  const candidates = new Set();
  for (const accepted of sources) for (const id of accepted) candidates.add(id);
  const priority = new Map(combinationPriority.map((id, index) => [id, index]));
  const itemIds = [...candidates].filter(id => (inventory.get(id) ?? 0) > 0);
  itemIds.sort((left, right) => {
    const leftPriority = priority.get(left);
    const rightPriority = priority.get(right);
    if (leftPriority !== undefined || rightPriority !== undefined) {
      if (leftPriority === undefined) return 1;
      if (rightPriority === undefined) return -1;
      return leftPriority - rightPriority;
    }
    return left - right;
  });
  const itemIndexes = new Map(itemIds.map((id, index) => [id, index]));
  const coverage = itemIds.map(id => sources.flatMap((accepted, index) => accepted.has(id) ? [index] : []));
  const memo = new Map();
  function isBetter(candidate, best, index) {
    if (best === null || candidate.totalSpend !== best.totalSpend) return best === null || candidate.totalSpend < best.totalSpend;
    if (candidate.comboSpend !== best.comboSpend) return candidate.comboSpend < best.comboSpend;
    for (const combo of combinationPriority) {
      const itemIndex = itemIndexes.get(combo);
      if (itemIndex === undefined || itemIndex < index) continue;
      const offset = itemIndex - index;
      const candidateCount = candidate.counts[offset] ?? 0;
      const bestCount = best.counts[offset] ?? 0;
      if (candidateCount !== bestCount) return candidateCount > bestCount;
    }
    return false;
  }
  function solve(index, remaining) {
    if (index === itemIds.length) {
      return remaining.every(count => count === 0) ? { totalSpend: 0, comboSpend: 0, counts: [] } : null;
    }
    const key = `${index}:${remaining.join(',')}`;
    if (memo.has(key)) return memo.get(key);
    const id = itemIds[index];
    const covered = coverage[index];
    const maxUseful = Math.max(0, ...covered.map(requirementIndex => remaining[requirementIndex]));
    const maxUsed = Math.min(inventory.get(id) ?? 0, maxUseful);
    let best = null;
    for (let used = 0; used <= maxUsed; used++) {
      const next = remaining.slice();
      if (used > 0) for (const requirementIndex of covered) next[requirementIndex] = Math.max(0, next[requirementIndex] - used);
      const suffix = solve(index + 1, next);
      if (suffix === null) continue;
      const candidate = {
        totalSpend: used + suffix.totalSpend,
        comboSpend: (priority.has(id) ? used : 0) + suffix.comboSpend,
        counts: [used, ...suffix.counts]
      };
      if (isBetter(candidate, best, index)) best = candidate;
    }
    memo.set(key, best);
    return best;
  }
  const best = solve(0, demands.map(({ count }) => count));
  if (best === null) return null;
  const expected = new Map(inventory);
  const spent = new Map();
  for (let index = 0; index < itemIds.length; index++) {
    const count = best.counts[index];
    if (count === 0) continue;
    const id = itemIds[index];
    expected.set(id, (expected.get(id) ?? 0) - count);
    spent.set(id, count);
  }
  return { inventory: expected, spent, totalSpend: best.totalSpend, comboSpend: best.comboSpend };
}
for (const row of rows) {
  const elementalSlots = rowRequirements(row).filter(({ rune }) => elements.has(rune)).map(({ rune }) => rune);
  assert.equal(new Set(elementalSlots).size, elementalSlots.length, `${row.debugname} repeats an elemental rune slot`);
  const distinct = new Set(elementalSlots).size;
  if (distinct > report.maxDistinctElementalTypes) report.maxDistinctElementalTypes = distinct;
}
report.maxDistinctElementalRows = rows
  .filter(row => rowRequirements(row).filter(({ rune }) => elements.has(rune)).length === report.maxDistinctElementalTypes)
  .map(row => ({ id: row.id, debugname: row.debugname }));
assert(report.maxDistinctElementalTypes <= 2,
  'the production minimizer supports at most two distinct elemental types; extend it before adding this row');
function spentRunes(before, after) {
  let spent = 0;
  for (const [id, count] of Object.entries(before)) spent += Math.max(0, count - (after[id] ?? 0));
  return spent;
}
function compareAcceptedPayment(row, label, before, oracle) {
  if (oracle === null) {
    expect(false, `${row.debugname} ${label} accepted without a cache-supported payment`);
    return;
  }
  const after = snapshot(inv);
  const spent = spentRunes(before, after);
  expect(debit(new Map(oracle.inventory)), `${row.debugname} ${label} did not use the minimum cache-supported spend`);
  expect(spent === oracle.totalSpend, `${row.debugname} ${label} spent ${spent}, minimum is ${oracle.totalSpend}`);
  report.minimumSpendComparisons++;
  report.minimumSpendUnits += oracle.totalSpend;
  report.productionSpendUnits += spent;
}
for (const row of rows) {
  const requirements = rowRequirements(row);
  for (const staff of staves) {
    const equipment = rowEquipment(row, staff);
    if (equipment === null) continue;
    const supplied = staffSupplies.get(equipment.find(id => ObjType.get(id).wearpos === 3)) ?? new Set();
    const remaining = requirements.filter(r => !supplied.has(r.rune));
    for (const mode of ['plain', 'staff-only', 'both']) {
      const inventory = baseInventory(mode === 'staff-only' ? remaining : requirements);
      inventory.set(995, 23);
      if (mode === 'both') for (const combo of combinations) inventory.set(combo, 50);
      seed(inventory, equipment);
      const before = snapshot(inv);
      const beforeWorn = snapshot(worn);
      const accepted = check(row);
      const oracle = expectedPayment(remaining, inventory);
      report.oracleCases++;
      expect(accepted === (oracle !== null), `${row.debugname} ${mode} staff=${staff} eligibility`, mode !== 'both');
      if (accepted) {
        pay(row);
        compareAcceptedPayment(row, `${mode} staff=${staff}`, before, oracle);
        assert.deepEqual(snapshot(worn), beforeWorn, 'a spell consumed worn equipment');
      } else {
        expect(JSON.stringify(snapshot(inv)) === JSON.stringify(before), `${row.debugname} ${mode} staff=${staff} refusal spent items`, mode !== 'both');
      }
      report.paymentCases++;
      if (mode === 'both') report.optimizedBothCases++;
      else report.unchangedPlainStaffCases++;
    }
    for (const combo of combinations) {
      const elemental = remaining.filter(r => elements.has(r.rune));
      const needed = Math.max(0, ...elemental.map(r => r.count));
      const inventory = baseInventory(remaining.filter(r => !elements.has(r.rune)));
      inventory.set(combo, needed + 1);
      seed(inventory, equipment);
      const before = snapshot(inv);
      const accepted = check(row);
      const oracle = expectedPayment(remaining, inventory);
      report.oracleCases++;
      expect(accepted === (oracle !== null), `${row.debugname} combo=${combo} staff=${staff} eligibility`);
      if (accepted) {
        pay(row);
        compareAcceptedPayment(row, `combo=${combo} staff=${staff}`, before, oracle);
      } else {
        expect(JSON.stringify(snapshot(inv)) === JSON.stringify(before), `${row.debugname} combo=${combo} staff=${staff} refusal spent items`);
      }
      report.paymentCases++;
      if (oracle !== null && needed > 0) {
        inventory.set(combo, needed - 1);
        seed(inventory, equipment);
        const insufficient = snapshot(inv);
        const insufficientAccepted = check(row);
        const insufficientOracle = expectedPayment(remaining, inventory);
        report.oracleCases++;
        expect(insufficientAccepted === (insufficientOracle !== null), `${row.debugname} insufficient combo=${combo} staff=${staff} eligibility`);
        expect(!insufficientAccepted, `${row.debugname} accepted insufficient combo=${combo} staff=${staff}`);
        expect(JSON.stringify(snapshot(inv)) === JSON.stringify(insufficient), `${row.debugname} insufficient check spent items`);
        expect(messages.some(m => m.includes('Runes to cast this spell.')), `${row.debugname} existing rune refusal text missing`);
        report.paymentCases++;
      }
    }
    for (const partialPlain of [false, true]) {
      const inventory = baseInventory(remaining.filter(r => !elements.has(r.rune)));
      inventory.set(995, 23);
      for (const req of remaining.filter(r => elements.has(r.rune))) {
        inventory.set(req.rune, partialPlain ? Math.floor(req.count / 2) : 0);
      }
      for (const combo of combinations) inventory.set(combo, (row.id + combo + (staff ?? 0)) % 4);
      seed(inventory, equipment);
      const before = snapshot(inv);
      const accepted = check(row);
      const oracle = expectedPayment(remaining, inventory);
      report.oracleCases++;
      expect(accepted === (oracle !== null), `${row.debugname} mixed partial=${partialPlain} staff=${staff} eligibility`);
      if (accepted) {
        pay(row);
        compareAcceptedPayment(row, `mixed partial=${partialPlain} staff=${staff}`, before, oracle);
      } else {
        expect(JSON.stringify(snapshot(inv)) === JSON.stringify(before), `${row.debugname} mixed partial=${partialPlain} staff=${staff} refusal spent items`);
      }
      report.paymentCases++;
      report.mixedPaymentCases++;
    }
  }
}
const faqFireBlast = rows.find(row => {
  const demand = new Map(rowRequirements(row).map(({ rune, count }) => [rune, count]));
  return demand.size === 3 && demand.get(554) === 5 && demand.get(556) === 4 && demand.get(560) === 1;
});
assert(faqFireBlast, 'packed Fire Blast row must match the exact FAQ requirements');
const faqFireBlastEquipment = rowEquipment(faqFireBlast, null);
assert(faqFireBlastEquipment !== null, 'Fire Blast required equipment must be available');
const faqFireBlastInventory = new Map([[554, 5], [556, 4], [4697, 10], [560, 1]]);
seed(faqFireBlastInventory, faqFireBlastEquipment);
const faqFireBlastBefore = snapshot(inv);
const faqFireBlastAccepted = check(faqFireBlast);
const faqFireBlastOracle = expectedPayment(rowRequirements(faqFireBlast), faqFireBlastInventory);
report.oracleCases++;
expect(faqFireBlastOracle !== null, 'cache acceptance sets must admit FAQ Fire Blast with five Fire, four Air, ten Smoke, and one Death');
expect(isDeepStrictEqual([...faqFireBlastOracle?.spent ?? []].sort((a, b) => a[0] - b[0]), [[554, 1], [560, 1], [4697, 4]]),
  'FAQ oracle must spend exactly four Smoke, one Fire and one Death');
expect(faqFireBlastAccepted, 'FAQ Fire Blast was refused');
if (faqFireBlastAccepted) {
  pay(faqFireBlast);
  compareAcceptedPayment(faqFireBlast, 'FAQ Fire Blast (4 Smoke + 1 Fire + 1 Death)', faqFireBlastBefore, faqFireBlastOracle);
} else {
  expect(JSON.stringify(snapshot(inv)) === JSON.stringify(faqFireBlastBefore), 'FAQ Fire Blast refusal spent items');
}
report.faqFireBlastCases++;

const faqNoPlainInventory = new Map([[4697, 10], [556, 4], [560, 1]]);
seed(faqNoPlainInventory, faqFireBlastEquipment);
const faqNoPlainBefore = snapshot(inv);
const faqNoPlainAccepted = check(faqFireBlast);
const faqNoPlainOracle = expectedPayment(rowRequirements(faqFireBlast), faqNoPlainInventory);
report.oracleCases++;
expect(faqNoPlainOracle !== null, 'cache acceptance sets must admit FAQ Fire Blast with Smoke, Air, and Death');
expect(isDeepStrictEqual([...faqNoPlainOracle?.spent ?? []].sort((a, b) => a[0] - b[0]), [[560, 1], [4697, 5]]),
  'FAQ no-plain-Fire control must spend exactly five Smoke and one Death');
expect(faqNoPlainAccepted, 'FAQ Fire Blast with no plain Fire was refused');
if (faqNoPlainAccepted) {
  pay(faqFireBlast);
  compareAcceptedPayment(faqFireBlast, 'FAQ Fire Blast without plain Fire (5 Smoke + 1 Death)', faqNoPlainBefore, faqNoPlainOracle);
} else {
  expect(JSON.stringify(snapshot(inv)) === JSON.stringify(faqNoPlainBefore), 'FAQ Fire Blast no-plain-Fire refusal spent items');
}
report.faqFireBlastCases++;


const restrictionRow = rows.find(row => {
  if (row.getValue(column('members'), 0)[0] !== 0) return false;
  const equipment = rowEquipment(row, null);
  if (equipment === null) return false;
  const supplied = staffSupplies.get(equipment.find(id => ObjType.get(id).wearpos === 3)) ?? new Set();
  const elemental = rowRequirements(row).filter(({ rune }) => elements.has(rune) && !supplied.has(rune));
  return elemental.length > 0 && combinationPriority.some(combo => elemental.every(({ rune }) => accepts.get(rune)?.has(combo)));
});
assert(restrictionRow, 'cache acceptance sets must contain a free-world spell covered by one combination rune');
const restrictionEquipment = rowEquipment(restrictionRow, null);
assert(restrictionEquipment !== null, 'free-world control required equipment must be available');
const restrictionRequirements = rowRequirements(restrictionRow);
const restrictionSupplied = staffSupplies.get(restrictionEquipment.find(id => ObjType.get(id).wearpos === 3)) ?? new Set();
const restrictionRemaining = restrictionRequirements.filter(({ rune }) => !restrictionSupplied.has(rune));
const restrictionElemental = restrictionRemaining.filter(({ rune }) => elements.has(rune));
const restrictionCombo = combinationPriority.find(combo => restrictionElemental.length > 0
  && restrictionElemental.every(({ rune }) => accepts.get(rune)?.has(combo)));
const restrictionInventory = baseInventory(restrictionRemaining.filter(({ rune }) => !elements.has(rune)));
restrictionInventory.set(restrictionCombo, Math.max(...restrictionElemental.map(({ count }) => count)));
seed(restrictionInventory, restrictionEquipment);
const restrictionMembersAccepted = check(restrictionRow);
const restrictionOracle = expectedPayment(restrictionRemaining, restrictionInventory);
report.oracleCases++;
expect(restrictionOracle !== null, `${restrictionRow.debugname} cache control inventory must be payable on members worlds`);
expect(restrictionMembersAccepted, `${restrictionRow.debugname} members-world combination control was refused`);
report.membersRestrictionCases++;
const originalMembersSetting = Environment.NODE_MEMBERS;
try {
  Environment.NODE_MEMBERS = false;
  seed(restrictionInventory, restrictionEquipment);
  const restrictionBefore = snapshot(inv);
  const restrictionFreeAccepted = check(restrictionRow);
  expect(!restrictionFreeAccepted, `${restrictionRow.debugname} used a members-only combination rune on a free world`);
  expect(JSON.stringify(snapshot(inv)) === JSON.stringify(restrictionBefore), `${restrictionRow.debugname} free-world refusal spent items`);
  report.membersRestrictionCases++;
} finally {
  Environment.NODE_MEMBERS = originalMembersSetting;
}

{
  const row = DbRowType.getByName('magic_spell_high_alch');
  assert(row, 'missing high alchemy row for free-world Steam reservation');
  const script = ScriptProvider.getByName('[opheldt,magic:highlvl_alchemy]');
  assert(script, 'missing compiled high alchemy handler for free-world Steam reservation');
  const inventory = new Map([[4694, 1], [554, 5], [561, 1], [995, 23]]);
  seed(inventory);
  p.stats.fill(130344310);
  p.levels.fill(99);
  p.baseLevels.fill(99);
  p.lastItem = 4694;
  p.lastSlot = inv.items.findIndex(i => i?.id === 4694);
  p.delayed = false;
  const beforeXp = p.stats[6];
  const expected = new Map(inventory);
  const alchCoins = Math.max(Math.floor(ObjType.get(4694).cost * 6 / 10), 1);
  expected.set(4694, 0);
  expected.set(554, 0);
  expected.set(561, 0);
  expected.set(995, 23 + alchCoins);
  const originalMembersSetting = Environment.NODE_MEMBERS;
  try {
    Environment.NODE_MEMBERS = false;
    const state = ScriptRunner.init(script, p);
    const result = p.runScript(state, true, true);
    expect([ScriptState.FINISHED, ScriptState.SUSPENDED].includes(result), `free-world high alchemy aborted: ${messages.join(' | ')}`);
    expect(result === ScriptState.SUSPENDED, 'free-world High Alch with Steam target and five plain Fire runes did not succeed');
    expect(debit(expected), 'free-world High Alch with Steam target and five plain Fire runes produced the wrong inventory or coins');
    expect(p.stats[6] - beforeXp === row.getValue(column('experience'), 0)[0], 'free-world High Alch Steam target gave the wrong XP');
  } finally {
    Environment.NODE_MEMBERS = originalMembersSetting;
  }
  report.freeWorldAlchemyCases++;
}


// Run the real inventory-target handlers through their payment/XP/output step.
// A successful alchemy handler then suspends at its ordinary animation delay.
for (const [name, numerator] of [['low', 4], ['high', 6]]) {
  const row = DbRowType.getByName(`magic_spell_${name}_alch`);
  assert(row, `missing ${name} alchemy row`);
  const requirements = rowRequirements(row);
  const fireFee = requirements.find(r => r.rune === 554).count;
  const script = ScriptProvider.getByName(`[opheldt,magic:${name === 'low' ? 'lowlvl' : 'highlvl'}_alchemy]`);
  assert(script, `missing compiled ${name} alchemy handler`);
  const cases = [];
  for (const target of [554, 4694, 4697, 4699]) {
    for (const count of new Set([1, 2, fireFee, fireFee + 1])) {
      cases.push({ target, inventory: new Map([[target, count], [561, 1]]), equipment: [], accepted: count >= fireFee + 1, label: `exclusive stack=${count}` });
    }
    // Exactly one missing fire unit: one target refuses, two pay one and alch one.
    const other = target === 554 ? 4694 : 554;
    for (const count of [1, 2]) {
      cases.push({ target, inventory: new Map([[target, count], [other, fireFee - 1], [561, 1]]), equipment: [], accepted: count === 2, label: `one-unit-short stack=${count}` });
    }
    cases.push({ target, inventory: new Map([[target, 1], [561, 1]]), equipment: [1387], accepted: true, label: 'fire-staff needs only target' });
    cases.push({ target, inventory: new Map([[target, 1], [other, fireFee], [561, 1]]), equipment: [], accepted: true, label: 'target reserved before other payment' });
  }
  for (const count of [1, 2]) {
    cases.push({ target: 561, inventory: new Map([[561, count], [554, fireFee]]), equipment: [], accepted: count === 2, label: `nature stack=${count}` });
  }
  for (const { target, inventory, equipment, accepted, label } of cases) {
    inventory.set(995, 23);
    seed(inventory, equipment);
    p.stats.fill(130344310);
    p.levels.fill(99);
    p.baseLevels.fill(99);
    p.lastItem = target;
    p.lastSlot = inv.items.findIndex(i => i?.id === target);
    p.delayed = false;
    const before = snapshot(inv);
    const beforeXp = p.stats[6];
    const state = ScriptRunner.init(script, p);
    const result = p.runScript(state, true, true);
    assert([ScriptState.FINISHED, ScriptState.SUSPENDED].includes(result), `${name} alchemy aborted: ${messages.join(' | ')}`);
    const expectedAfterTarget = new Map(inventory);
    if (accepted) {
      expectedAfterTarget.set(target, expectedAfterTarget.get(target) - 1);
      const supplied = staffSupplies.get(equipment[0]) ?? new Set();
      const remaining = requirements.filter(r => !supplied.has(r.rune));
      const paid = expectedPayment(remaining, expectedAfterTarget);
      report.oracleCases++;
      expect(paid !== null, `${name} alchemy target=${target} ${label} has no cache-supported payment`);
      if (paid !== null) {
        paid.inventory.set(995, paid.inventory.get(995) + Math.max(Math.floor(ObjType.get(target).cost * numerator / 10), 1));
        expect(debit(new Map(paid.inventory)), `${name} alchemy target=${target} ${label} inventory/coins`);
      } else {
        expect(false, `${name} alchemy target=${target} ${label} accepted without a minimum payment`);
      }
      expect(p.stats[6] - beforeXp === row.getValue(column('experience'), 0)[0], `${name} alchemy target=${target} ${label} XP`);
    } else {
      expect(JSON.stringify(snapshot(inv)) === JSON.stringify(before), `${name} alchemy target=${target} ${label} refusal lost items`);
      expect(p.stats[6] === beforeXp, `${name} alchemy target=${target} ${label} refusal gave XP`);
      const rune = target === 561 ? 'Nature' : 'Fire';
      expect(messages.includes(`You do not have enough ${rune} Runes to cast this spell.`), `${name} alchemy target=${target} ${label} changed refusal`);
    }
    report.alchemyCases++;
  }
}
report.affectedButtons = [...affected].sort((a, b) => a - b);
report.verdict = report.mismatches === 0 ? 'PASS' : 'FAIL';
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`RESULT ${report.verdict}: ${report.tableCases} inventory/equipment comparisons over 122 buttons (65 targeted + 57 other), ${report.cacheExpectedDisagreements} evidenced 13136/12891 disagreements, ${report.mismatches} failures`);
console.log(`PAYMENT: ${report.existingRows} existing rows, ${report.paymentCases} cases, ${report.unchangedPlainStaffCases} unchanged plain/staff cases, ${report.optimizedBothCases} both-inventory minimum-spend cases`);
console.log(`MINIMUM SPEND: ${report.minimumSpendComparisons} packed payments vs. cache oracle; ${report.minimumSpendUnits} oracle runes and ${report.productionSpendUnits} production runes`);
console.log(`ELEMENTS: maximum ${report.maxDistinctElementalTypes} distinct types; rows ${report.maxDistinctElementalRows.map(row => `${row.id}:${row.debugname}`).join(', ') || '(none)'}`);
console.log(`NAMED CASES: FAQ Fire Blast ${report.faqFireBlastCases}; members controls ${report.membersRestrictionCases}; free-world High Alch ${report.freeWorldAlchemyCases}`);
console.log(`MIXED: ${report.mixedPaymentCases} payment cases; ALCHEMY: ${report.alchemyCases} real handler reservation cases`);
if (report.affectedButtons.length) console.log(`AFFECTED BUTTONS: ${report.affectedButtons.join(',')}`);
for (const failure of report.failures.slice(0, 5)) console.log(`FAIL ${failure}`);
for (const example of report.examples.slice(0, 3)) console.log(`DIFF ${JSON.stringify(example)}`);
process.exit(report.verdict === 'PASS' ? 0 : 1);
