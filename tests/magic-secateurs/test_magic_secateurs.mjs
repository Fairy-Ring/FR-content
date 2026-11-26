/** Controlled-RNG differential contracts against the current complete pack.
 * Run from the sibling engine: node --import tsx ../content/tests/magic-secateurs/test_magic_secateurs.mjs
 * Period eligibility/equipment rule is VERIFIED. The base model is an OSRS
 * CANDIDATE. Multiplier rounding and crop endpoints remain UNKNOWN, not 377 rates.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, Scripts, State, ScriptOpcode, PlayerStat, types, id, inv, player, proc,
  add, count, use, click, load } from '../farming/runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const map = await load('engine/GameMap.ts');
const worn = id('InvType', 'worn');
const magic = types.ObjType.get(id('ObjType', 'fairy_enchanted_secateurs'));
assert.equal(magic.tradeable, false, 'quest reward is untradeable in server configuration');
assert.equal(magic.iop[1], 'Wield');
const rhand = magic.wearpos;
const gearModes = ['bare', 'ordinary', 'inventory-magic', 'wielded'];
const patchNames = ['farming_veg_patch_1', 'farming_herb_patch_1', 'farming_hops_patch_1',
  'farming_flower_patch_1', 'farming_bush_patch_1', 'farming_tree_patch_1',
  'farming_fruit_tree_patch_1', 'farming_calquat_tree_patch', 'farming_spirit_tree_patch_1'];
const patches = new Map();
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: |$)/.exec(line);
    if (!match) continue;
    const [level, x, z, type] = match.slice(1).map(Number);
    const config = types.LocType.get(type);
    if (!patchNames.includes(config.debugname) || patches.has(config.debugname)) continue;
    const loc = World.getLoc(mx * 64 + x, mz * 64 + z, level, type);
    assert(loc, `real packed ${config.debugname}`);
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const ax = loc.x + dx, az = loc.z + dz;
      if (!map.isMapBlocked(ax, az, level) && map.reachedLoc(level, ax, az, loc.x, loc.z,
        config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) {
        patches.set(config.debugname, { loc, x: ax, z: az, selector: config.multivarbit });
        break;
      }
    }
  }
}
for (const name of patchNames) assert(patches.has(name), `collision-reachable ${name}`);
function equip(p, mode) {
  if (mode === 'wielded') p.getInventory(worn).set(rhand, { id: magic.id, count: 1 });
  else if (mode === 'inventory-magic') add(p, magic.debugname);
  else if (mode === 'ordinary') add(p, 'secateurs');
}
function fixture(patchName, stage, mode = 'bare', level = 99) {
  const at = patches.get(patchName), p = player();
  p.x = at.x; p.z = at.z; p.level = at.loc.level;
  p.setLevel(PlayerStat.FARMING, level);
  p.setVarBit(at.selector, stage);
  p.startXp = p.stats[PlayerStat.FARMING];
  add(p, 'spade'); equip(p, mode);
  return { p, ...at };
}
function rows(name, fields) {
  const table = types.DbTableType.getByName(name);
  assert(table, name);
  return types.DbRowType.getInTable(table.id).map(row => Object.fromEntries(fields.map(field => {
    const column = table.columnNames.indexOf(field);
    assert(column >= 0, `${name}:${field}`);
    return [field, row.getValue(column, 0)[0]];
  })));
}
const families = [
  { table: 'farming_allotment', patch: patchNames[0], low: 64, high: 128 },
  { table: 'farming_herb', patch: patchNames[1], low: 64, high: 80 },
  { table: 'farming_hops', patch: patchNames[2], low: 64, high: 128 },
];
const baseSave = (level, low, high) => 1 + Math.floor((low * (99 - Math.min(level, 99)) + high * (Math.min(level, 99) - 1)) / 98 + 0.5);
const loss = (level, family, mode) => 256 - Math.floor(baseSave(level, family.low, family.high) * (mode === 'wielded' ? 110 : 100) / 100);
let checks = 0;
const random = Runner.HANDLERS[ScriptOpcode.RANDOM];
let draw = 0, draws = 0;
Runner.HANDLERS[ScriptOpcode.RANDOM] = state => {
  assert.equal(state.popInt(), 256, 'harvest uses the existing 256-outcome roll');
  assert(draw >= 0 && draw < 256); draws++; state.pushInt(draw);
};
try {
  // Exhaust every level and every integer roll. A save multiplier must not be
  // mistaken for +10 percentage points or a multiplier of the loss chance.
  for (const family of families) {
    for (const mode of gearModes) {
      const p = player(); equip(p, mode);
      try {
        for (const level of [...Array.from({ length: 99 }, (_, index) => index + 1), 120]) {
          p.setLevel(PlayerStat.FARMING, level);
          const actual = proc(p, `${family.table}_life_loss`).popInt();
          assert.equal(actual, loss(level, family, mode), `${family.table} ${mode} level ${level}`);
          let saved = 0;
          for (let roll = 0; roll < 256; roll++) if (roll >= actual) saved++;
          assert.equal(saved, 256 - loss(level, family, mode));
          checks++;
        }
      } finally { p.unlink(); }
    }
    // Every eligible species uses its real visible loc handler. Both sides of
    // both thresholds prove a differential, not a random sample or proc-only test.
    for (const crop of rows(family.table, ['mature', 'last', 'produce', 'harvest_xp'])) {
      for (const level of [1, 50, 99]) {
        const bareLoss = loss(level, family, 'bare'), magicLoss = loss(level, family, 'wielded');
        assert(magicLoss < bareLoss);
        for (const mode of gearModes) {
          // Reuse the player across rolls to stay within the protocol's PID range.
          const { p, loc, selector } = fixture(family.patch, crop.mature, mode, level);
          try {
            for (const roll of new Set([0, magicLoss - 1, magicLoss, bareLoss - 1, bareLoss, 255])) {
              p.setVarBit(selector, crop.mature);
              p.invDel(inv, crop.produce, p.invTotal(inv, crop.produce));
              p.setLevel(PlayerStat.FARMING, level);
              p.startXp = p.stats[PlayerStat.FARMING];
              draw = roll; draws = 0; World.currentTick += 3;
              assert(click(p, loc, 1), 'native visible-form Harvest/Pick packet accepted');
              assert.equal(draws, 1, 'one roll per successful pick');
              assert.equal(p.invTotal(inv, crop.produce), 1);
              assert.equal(p.stats[PlayerStat.FARMING] - p.startXp, crop.harvest_xp);
              assert.equal(p.getVarBit(selector), crop.mature + Number(roll < loss(level, family, mode)),
                `${family.table} ${mode} level ${level} roll ${roll}`);
              checks++;
            }
          } finally { p.unlink(); }
        }
      }
    }
    // A single extra saved pick followed by three life losses gives four items,
    // three lives consumed, and four XP awards for each eligible crop family.
    const crop = rows(family.table, ['mature', 'last', 'produce', 'harvest_xp'])[0];
    const { p, loc, selector } = fixture(family.patch, crop.mature, 'wielded');
    try {
      for (const roll of [loss(99, family, 'wielded'), 0, 0, 0]) {
        draw = roll; World.currentTick += 3; assert(click(p, loc));
      }
      assert.equal(p.getVarBit(selector), 3);
      assert.equal(p.invTotal(inv, crop.produce), 4);
      assert.equal(p.stats[PlayerStat.FARMING] - p.startXp, crop.harvest_xp * 4);
      checks++;
    } finally { p.unlink(); }
  }
  // Ineligible flowers, bushes and fruit trees retain their fixed yields and XP.
  for (const spec of [
    { patch: patchNames[3], stage: 32, after: 3, produce: 'limpwurt_root', quantity: 3, xp: 1200 },
    { patch: patchNames[4], stage: 14, after: 13, produce: 'redberries', quantity: 1, xp: 40 },
    { patch: patchNames[6], stage: 20, after: 19, produce: 'cooking_apple', quantity: 1, xp: 85 },
    { patch: patchNames[7], stage: 18, after: 17, produce: 'calquat_fruit', quantity: 1, xp: 485 },
  ]) for (const mode of gearModes) {
    const { p, loc, selector } = fixture(spec.patch, spec.stage, mode);
    try {
      draws = 0; World.currentTick += 3; assert(click(p, loc));
      assert.equal(draws, 0, 'ineligible harvest performs no life-save roll');
      assert.equal(p.getVarBit(selector), spec.after);
      assert.equal(count(p, spec.produce), spec.quantity);
      assert.equal(p.stats[PlayerStat.FARMING] - p.startXp, spec.xp);
      checks++;
    } finally { p.unlink(); }
  }
  // Every existing ordinary-secateurs pruning family accepts magic secateurs
  // through the same real item-on-visible-loc packet and retains the tool.
  for (const spec of [
    { patch: patchNames[4], sick: 70, healthy: 6 },
    { patch: patchNames[5], sick: 73, healthy: 9 },
    { patch: patchNames[6], sick: 21, healthy: 9 },
    { patch: patchNames[7], sick: 19, healthy: 5 },
    { patch: patchNames[8], sick: 21, healthy: 9 },
  ]) for (const tool of ['secateurs', magic.debugname]) {
    const { p, loc, selector } = fixture(spec.patch, spec.sick);
    try {
      add(p, tool); const before = p.stats[PlayerStat.FARMING];
      assert(use(p, tool, loc));
      assert.equal(p.getVarBit(selector), spec.healthy, `${spec.patch} ${tool} pruning parity`);
      assert.equal(count(p, tool), 1);
      assert.equal(p.stats[PlayerStat.FARMING], before);
      checks++;
    } finally { p.unlink(); }
  }
} finally { Runner.HANDLERS[ScriptOpcode.RANDOM] = random; }
console.log(`PASS ${checks} deterministic Magic Secateurs contracts; all eligible crops, wield-only thresholds, exclusions and pruning parity`);

// The lost tool remains recoverable both before the boss and after completion.
// Reclaim is existing quest code, not a second award or a change to quest stages.
const ScriptPointer = await load('engine/script/ScriptPointer.ts');
const mortifer = [...World.npcs].find(npc => npc.type === id('NpcType', 'elemental_wizard_boss'));
assert(mortifer, 'original-map Malignus Mortifer exists');
const questBit = id('VarBitType', 'fairy_farmers_quest');
for (const questStage of [40, 90]) {
  const p = player();
  try {
    p.setVarBit(questBit, questStage);
    add(p, 'coins', 40000);
    const script = Scripts.getByName('[opnpc1,elemental_wizard_boss]');
    assert(script);
    const state = Runner.init(script, p, mortifer, []);
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    p.executeScript(state, true, true);
    let selected = false;
    for (let step = 0; state.execution !== State.FINISHED && step < 50; step++) {
      if (state.execution === State.SUSPENDED) {
        World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
        p.delayed = false;
      } else {
        assert.equal(state.execution, State.PAUSEBUTTON);
        const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName : '';
        if (root === 'multi2') {
          assert.equal(selected, false);
          p.lastCom = id('Component', 'multi2:com_1');
          assert(p.resumeButtons.includes(p.lastCom));
          selected = true;
        }
      }
      p.executeScript(state, true, true);
    }
    assert.equal(state.execution, State.FINISHED, 'replacement dialogue finishes');
    assert(selected, 'replacement price is accepted through its real choice');
    assert.equal(count(p, 'coins'), 0);
    assert.equal(count(p, magic.debugname), 1);
    assert.equal(p.getVarBit(questBit), questStage, 'reclaim does not replay quest progress');
  } finally { p.unlink(); }
}
console.log('PASS lost magic secateurs recover for 40,000 coins at enchantment and completion');
process.exit(0);
