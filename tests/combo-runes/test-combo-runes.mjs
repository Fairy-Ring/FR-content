#!/usr/bin/env node
// Run from the sibling engine after its full pack: node --import tsx ../content/tests/combo-runes/test-combo-runes.mjs
// No server starts. The server side executes the packed production RuneScript, not a JS translation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  unchangedPlainStaffCases: 0, plainStaffFailures: 0, failures: []
};
const affected = new Set();
function expect(condition, description, plainStaff = false) {
  if (!condition) {
    report.mismatches++;
    if (plainStaff) report.plainStaffFailures++;
    if (report.failures.length < 16) report.failures.push(description);
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
// Payment policy oracle uses the cache-derived acceptance sets, not the server pairing map.
function expectedPayment(requirements, inventory) {
  const expected = new Map(inventory);
  const deficit = requirements.map(({ rune, count }) => {
    const used = Math.min(count, expected.get(rune) ?? 0);
    expected.set(rune, (expected.get(rune) ?? 0) - used);
    return { rune, count: count - used };
  });
  for (const combo of combinationPriority) {
    const paid = deficit.filter(r => accepts.get(r.rune).has(combo));
    const used = Math.min(expected.get(combo) ?? 0, Math.max(0, ...paid.map(r => r.count)));
    expected.set(combo, (expected.get(combo) ?? 0) - used);
    for (const req of paid) req.count = Math.max(0, req.count - used);
  }
  assert(deficit.every(r => r.count === 0), 'accepted input cannot pay all requirements');
  return expected;
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
      const beforeWorn = snapshot(worn);
      const accepted = check(row);
      expect(accepted, `${row.debugname} ${mode} staff=${staff} rejected`, true);
      if (accepted) {
        pay(row);
        const expected = new Map(inventory);
        for (const req of remaining) expected.set(req.rune, expected.get(req.rune) - req.count);
        expect(debit(expected), `${row.debugname} changed plain/staff cost in ${mode} staff=${staff}`, true);
        assert.deepEqual(snapshot(worn), beforeWorn, 'a spell consumed worn equipment');
      }
      report.paymentCases++;
      report.unchangedPlainStaffCases++;
    }
    for (const combo of combinations) {
      const elemental = remaining.filter(r => elements.has(r.rune));
      const supported = elemental.every(r => accepts.get(r.rune).has(combo));
      const needed = Math.max(0, ...elemental.map(r => r.count));
      const inventory = baseInventory(remaining.filter(r => !elements.has(r.rune)));
      inventory.set(combo, needed + 1);
      seed(inventory, equipment);
      const before = snapshot(inv);
      const accepted = check(row);
      expect(accepted === supported, `${row.debugname} combo=${combo} staff=${staff} eligibility`);
      if (accepted) {
        pay(row);
        const expected = new Map(inventory);
        for (const req of remaining.filter(r => !elements.has(r.rune))) expected.set(req.rune, 0);
        expected.set(combo, inventory.get(combo) - needed);
        expect(debit(expected), `${row.debugname} combo=${combo} staff=${staff} must debit max paired demand ${needed}`);
      } else assert.deepEqual(snapshot(inv), before, 'refusal spent items');
      report.paymentCases++;
      if (supported && needed > 0) {
        inventory.set(combo, needed - 1);
        seed(inventory, equipment);
        const insufficient = snapshot(inv);
        expect(!check(row), `${row.debugname} accepted insufficient combo=${combo} staff=${staff}`);
        assert.deepEqual(snapshot(inv), insufficient, 'insufficient check spent items');
        assert(messages.some(m => m.includes('Runes to cast this spell.')), 'existing rune refusal text missing');
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
      const wanted = remaining.every(r => [...accepts.get(r.rune)].reduce((n, id) => n + (inventory.get(id) ?? 0), 0) >= r.count);
      seed(inventory, equipment);
      const before = snapshot(inv);
      const accepted = check(row);
      expect(accepted === wanted, `${row.debugname} mixed partial=${partialPlain} staff=${staff} eligibility`);
      if (accepted) {
        pay(row);
        expect(debit(expectedPayment(remaining, inventory)), `${row.debugname} mixed partial=${partialPlain} staff=${staff} payment priority`);
      } else assert.deepEqual(snapshot(inv), before, 'mixed refusal spent items');
      report.paymentCases++;
      report.mixedPaymentCases++;
    }
  }
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
    const expected = new Map(inventory);
    if (accepted) {
      expected.set(target, expected.get(target) - 1);
      const supplied = staffSupplies.get(equipment[0]) ?? new Set();
      const remaining = requirements.filter(r => !supplied.has(r.rune));
      const paid = expectedPayment(remaining, expected);
      paid.set(995, paid.get(995) + Math.max(Math.floor(ObjType.get(target).cost * numerator / 10), 1));
      expect(debit(paid), `${name} alchemy target=${target} ${label} inventory/coins`);
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
console.log(`RESULT ${report.verdict}: ${report.tableCases} inventory/equipment comparisons over 122 buttons (65 targeted + 57 other), ${report.cacheExpectedDisagreements} evidenced 13136/12891 disagreements, ${report.mismatches} unexpected failures`);
console.log(`PAYMENT: ${report.existingRows} existing rows, ${report.paymentCases} cases, ${report.unchangedPlainStaffCases} unchanged plain/staff/both cost cases`);
console.log(`MIXED: ${report.mixedPaymentCases} payment cases; ALCHEMY: ${report.alchemyCases} real handler reservation cases`);
if (report.affectedButtons.length) console.log(`AFFECTED BUTTONS: ${report.affectedButtons.join(',')}`);
for (const failure of report.failures.slice(0, 5)) console.log(`FAIL ${failure}`);
for (const example of report.examples.slice(0, 3)) console.log(`DIFF ${JSON.stringify(example)}`);
process.exit(report.verdict === 'PASS' ? 0 : 1);
