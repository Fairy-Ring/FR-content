/** Run from engine: NODE_MEMBERS=true NODE_XPRATE=1 node --import tsx ../content/tests/pickpocketing/test_pickpocketing.mjs */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const Environment = (await import(pathToFileURL(path.join(engine, 'src/util/Environment.ts')).href)).default;
Environment.NODE_MEMBERS = true;
Environment.NODE_XPRATE = 1;
const { World, JavaRandom, PlayerStat, types, id, placed, prepared, snapshot, attempt, dispose, cleanup } = await import('./runtime.mjs');

// Published sibling values are an independent control, not derived from the new rows.
const aliases = [
  { row: 'pickpocket_man', forms: ['man4_for_musa_point', 'death_man_indoors1',
    'falador_doric_area_man1', 'falador_doric_area_man2', 'falador_doric_area_man3',
    'falador_doric_area_man4', 'rimmington_hengel', 'man'],
    level: 1, xp: 80, stun: 8, damage: 1, chance: [180, 240], loot: [['coins', 3, 3, 128]], total: 0 },
  { row: 'pickpocket_woman', forms: ['rimmington_anja'],
    level: 1, xp: 80, stun: 8, damage: 1, chance: [180, 240], loot: [['coins', 3, 3, 128]], total: 0 },
  { row: 'pickpocket_guard', forms: ['falador_doric_area_guard', 'jail_guard_1', 'jail_guard_2',
    'jail_guard_3', 'jail_guard_4', 'jail_guard_5', 'guard1'],
    level: 40, xp: 468, stun: 8, damage: 2, chance: [50, 240], loot: [['coins', 30, 30, 128]], total: 0 },
  { row: 'pickpocket_paladin', forms: ['paladin2', 'paladin'],
    level: 70, xp: 1518, stun: 8, damage: 3, chance: [50, 150],
    loot: [['coins', 80, 80, 128], ['chaosrune', 2, 2, 128]], total: 0 }
];
// Independent retained OSRS 14342251 weights, with period objects and pre-pouch coins.
const hamLoot = [
  ['ham_shirt', 1, 1, 11], ['ham_robe', 1, 1, 11], ['ham_hood', 1, 1, 11],
  ['ham_cloak', 1, 1, 11], ['ham_badge', 1, 1, 11], ['ham_gloves', 1, 1, 11], ['ham_boots', 1, 1, 11],
  ['bronze_arrow', 1, 13, 33], ['bronze_axe', 1, 1, 33], ['bronze_dagger', 1, 1, 33], ['bronze_pickaxe', 1, 1, 33],
  ['iron_axe', 1, 1, 33], ['iron_dagger', 1, 1, 33], ['iron_pickaxe', 1, 1, 33], ['leather_armour', 1, 1, 33],
  ['steel_arrow', 1, 13, 22], ['steel_axe', 1, 1, 22], ['steel_dagger', 1, 1, 22], ['steel_pickaxe', 1, 1, 22],
  ['digsitebuttons', 1, 1, 44], ['digsitearmour1', 1, 1, 44], ['digsitesword', 1, 1, 44],
  ['feather', 1, 7, 33], ['knife', 1, 1, 22], ['needle', 1, 1, 22],
  ['raw_anchovies', 1, 1, 22], ['raw_chicken', 1, 1, 22], ['tinderbox', 1, 1, 22],
  ['uncut_opal', 1, 1, 22], ['coal', 1, 1, 22], ['iron_ore', 1, 1, 22], ['uncut_jade', 1, 1, 22],
  ['logs', 1, 1, 33], ['cow_hide', 1, 1, 33], ['thread', 1, 10, 33],
  ['unidentified_guam', 1, 1, 12], ['unidentified_marentill', 1, 1, 6], ['unidentified_tarromin', 1, 1, 4],
  ['coins', 1, 21, 165], ['trail_clue_easy_map001', 1, 1, 22]
];

const additions = [
  { row: 'pickpocket_fremennik', forms: ['viking_man', 'viking_man2', 'viking_man3', 'viking_man4', 'viking_man5',
    'viking_woman', 'viking_woman2', 'viking_woman3', 'viking_woman4', 'viking_woman_indoors'],
    level: 45, xp: 650, stun: 8, damage: 2, chance: [50, 240], loot: [['coins', 40, 40, 128]], total: 128,
    quest: { name: 'viking', complete: 10 } },
  { row: 'pickpocket_ham_female', forms: ['favour_female_ham_civilian'],
    level: 15, xp: 185, stun: 8, damage: 1, damageMax: 2, chance: [50, 240], loot: hamLoot, total: 1100 },
  { row: 'pickpocket_ham_male', forms: ['favour_male_ham_civilian'],
    level: 20, xp: 225, stun: 8, damage: 2, damageMax: 3, chance: [50, 240], loot: hamLoot, total: 1100 },
  { row: 'pickpocket_desert_bandit', forms: ['fourdiamonds_sword_bandit_1', 'fourdiamonds_sword_bandit_free'],
    level: 53, xp: 790, stun: 8, damage: 3, chance: [50, 240],
    loot: [['coins', 30, 30, 5], ['1doseantipoison', 1, 1, 1], ['lockpick', 1, 1, 1]], total: 7 },
  { row: 'pickpocket_lletya_elf', forms: ['mourning_town_elf_1', 'mourning_town_elf_2', 'mourning_town_elf_3',
    'mourning_town_elf_4', 'mourning_town_elf_5'],
    level: 85, xp: 3530, stun: 8, damage: 5, chance: [50, 240],
    loot: [['coins', 250, 350, 105], ['deathrune', 2, 2, 8], ['naturerune', 3, 3, 5], ['jug_wine', 1, 1, 6],
      ['diamond', 1, 1, 1], ['fire_orb', 1, 1, 2], ['gold_ore', 1, 1, 1],
      ['unicorn_horn', 1, 1, 1], ['black_robe', 1, 1, 1]], total: 130 }
];

function prepare(spec, entry, level) {
  const p = prepared(entry, level);
  if (spec.quest) p.setVar(id('VarPlayerType', spec.quest.name), spec.quest.complete);
  return p;
}

let checks = 0;
function test(name, action) { action(); checks++; console.log(`PASS ${name}`); }
const levelChance = (level, [low, high]) => Math.floor(low * (99 - level) / 98) + Math.floor(high * (level - 1) / 98) + 1;
const clueRepresentative = 'trail_clue_easy_map001';
const easyClueCategory = id('CategoryType', 'trail_clue_easy');
const matchesReward = (name, obj) => name === clueRepresentative
  ? types.ObjType.get(obj).category === easyClueCategory
  : id('ObjType', name) === obj;
function seedFor(spec, success, damage) {
  const chance = levelChance(spec.level, spec.chance);
  for (let seed = 0; seed < 100_000; seed++) {
    JavaRandom.setSeed(seed);
    if ((Math.floor(JavaRandom.nextDouble() * 256) < chance) === success &&
        (damage === undefined || failureDamage(spec, seed) === damage)) return seed;
  }
  assert.fail('native RNG supplies the requested success/failure witness');
}
function failureDamage(spec, seed) {
  if (spec.damageMax === undefined) return spec.damage;
  JavaRandom.setSeed(seed);
  JavaRandom.nextDouble(); // The shared stat_random failure roll.
  return spec.damage + Math.trunc(JavaRandom.nextDouble() * (spec.damageMax - spec.damage + 1));
}
function exclusiveWitnesses(spec) {
  const found = new Map();
  const chance = levelChance(spec.level, spec.chance);
  for (let seed = 0; seed < 200_000 && found.size < spec.loot.length; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * 256) >= chance) continue;
    let denominator = spec.total;
    for (let index = spec.loot.length - 1; index >= 0; index--) {
      const roll = Math.trunc(JavaRandom.nextDouble() * denominator);
      denominator -= spec.loot[index][3];
      if (roll >= denominator) {
        if (!found.has(index)) found.set(index, seed);
        break;
      }
    }
  }
  assert.equal(found.size, spec.loot.length, `${spec.row} has a native RNG witness for each source reward`);
  return found;
}
function checkRow(spec) {
  const row = types.DbRowType.getByName(spec.row);
  assert(row, `${spec.row} is packed`);
  for (const [col, value] of [[1, spec.level], [2, spec.xp], [3, spec.stun], [4, spec.damage], [8, spec.total]]) {
    assert.deepEqual(row.getValue(col, 0), [value], `${spec.row} source column ${col}`);
  }
  if (spec.damageMax !== undefined) assert.deepEqual(row.getValue(9, 0), [spec.damageMax]);
  assert.deepEqual(row.getValue(5, 0), spec.chance);
  assert.equal(row.columnValues[6].length, spec.loot.length * 4);
  for (let i = 0; i < spec.loot.length; i++) {
    const [name, ...values] = spec.loot[i];
    assert.deepEqual(row.getValue(6, i), [id('ObjType', name), ...values], `${spec.row} source reward ${name}`);
  }
  const npcIds = row.columnValues[0];
  for (const form of spec.forms) assert(npcIds.includes(id('NpcType', form)), `${spec.row} binds ${form}`);
  return row;
}
function exercise(spec) {
  test(`${spec.row} matches independent source values`, () => checkRow(spec));
  const success = seedFor(spec, true), failure = seedFor(spec, false);
  for (const form of spec.forms) {
    const entry = placed(form);
    if (spec.quest) test(`${form}: native quest refusal before completion`, () => {
      const p = prepared(entry, spec.level);
      const xp = p.stats[PlayerStat.THIEVING];
      try {
        p.setVar(id('VarPlayerType', spec.quest.name), spec.quest.complete - 1);
        attempt(p, entry, success);
        assert.deepEqual(snapshot(p), []);
        assert.equal(p.stats[PlayerStat.THIEVING], xp);
        assert.equal(p.levels[PlayerStat.HITPOINTS], 99);
        assert(p.messages.some(text => text.includes('Fremennik Trials')));
      } finally { dispose(p); }
    });
    test(`${form}: native level refusal`, () => {
      const p = prepare(spec, entry, spec.level - 1);
      const xp = p.stats[PlayerStat.THIEVING];
      try {
        attempt(p, entry, success);
        assert.deepEqual(snapshot(p), []);
        assert.equal(p.stats[PlayerStat.THIEVING], xp);
        assert.equal(p.levels[PlayerStat.HITPOINTS], 99);
        assert.equal(p.getVar(id('VarPlayerType', 'stunned')), 0);
      } finally { dispose(p); }
    });
    test(`${form}: native success grants only table loot and source XP`, () => {
      const p = prepare(spec, entry, spec.level);
      const xp = p.stats[PlayerStat.THIEVING];
      try {
        attempt(p, entry, success);
        assert.equal(p.activeScript, null);
        assert.equal(p.stats[PlayerStat.THIEVING] - xp, spec.xp);
        assert.equal(p.levels[PlayerStat.HITPOINTS], 99);
        const items = snapshot(p);
        assert(items.length, 'success produces loot');
        if (spec.total > 0) assert.equal(items.length, 1, 'exclusive table produces one reward');
        for (const [obj, quantity] of items) {
          const source = spec.loot.find(([name]) => matchesReward(name, obj));
          assert(source, 'reward belongs to the source table');
          assert(quantity >= source[1] && quantity <= source[2], 'reward quantity is within the source range');
        }
        if (spec.total === 0 && spec.loot.every(row => row[3] === 128)) {
          assert.deepEqual(items, spec.loot.map(([name, min]) => [id('ObjType', name), min]).sort((a, b) => a[0] - b[0]));
        }
      } finally { dispose(p); }
    });
    test(`${form}: native failure damages, stuns and refuses immediate retry`, () => {
      const p = prepare(spec, entry, spec.level);
      const xp = p.stats[PlayerStat.THIEVING];
      const damage = failureDamage(spec, failure);
      try {
        attempt(p, entry, failure);
        assert.equal(p.activeScript, null);
        assert.deepEqual(snapshot(p), []);
        assert.equal(p.stats[PlayerStat.THIEVING], xp);
        assert.equal(p.levels[PlayerStat.HITPOINTS], 99 - damage);
        assert.equal(p.getVar(id('VarPlayerType', 'stunned')), World.currentTick + spec.stun);
        attempt(p, entry, success);
        assert.deepEqual(snapshot(p), []);
        assert.equal(p.stats[PlayerStat.THIEVING], xp);
        assert.equal(p.levels[PlayerStat.HITPOINTS], 99 - damage);
      } finally { dispose(p); }
    });
  }
  if (spec.damageMax !== undefined) {
    const entry = placed(spec.forms[0]);
    for (let damage = spec.damage; damage <= spec.damageMax; damage++) test(`${spec.row}: inclusive failure damage ${damage}`, () => {
      const p = prepare(spec, entry, spec.level);
      try {
        attempt(p, entry, seedFor(spec, false, damage));
        assert.equal(p.levels[PlayerStat.HITPOINTS], 99 - damage);
        assert.deepEqual(snapshot(p), []);
      } finally { dispose(p); }
    });
  }
  if (spec.total > 0) {
    const entry = placed(spec.forms[0]);
    const witnesses = exclusiveWitnesses(spec);
    for (const [index, seed] of witnesses) test(`${spec.row}: source reward ${spec.loot[index][0]}`, () => {
      const p = prepare(spec, entry, spec.level);
      try {
        attempt(p, entry, seed);
        const [name, min, max] = spec.loot[index];
        const items = snapshot(p);
        assert.equal(items.length, 1);
        assert(matchesReward(name, items[0][0]), 'selected source reward or existing easy-clue variant');
        assert(items[0][1] >= min && items[0][1] <= max);
      } finally { dispose(p); }
    });
    const clueIndex = spec.loot.findIndex(([name]) => name === clueRepresentative);
    if (clueIndex >= 0) for (const storage of ['inv', 'bank']) test(`${spec.row}: held ${storage} clue is not duplicated`, () => {
      const p = prepare(spec, entry, spec.level);
      try {
        p.invAdd(id('InvType', storage), id('ObjType', clueRepresentative), 1);
        const before = snapshot(p), xp = p.stats[PlayerStat.THIEVING];
        attempt(p, entry, witnesses.get(clueIndex));
        assert.deepEqual(snapshot(p), before);
        assert.equal(p.invTotal(id('InvType', storage), id('ObjType', clueRepresentative)), 1);
        assert.equal(p.stats[PlayerStat.THIEVING] - xp, spec.xp);
      } finally { dispose(p); }
    });
  }
}
for (const spec of [...aliases, ...additions]) exercise(spec);
cleanup();
console.log(`${checks} compiled pickpocket checks passed`);
process.exit(0);
