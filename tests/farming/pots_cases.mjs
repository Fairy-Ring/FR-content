import assert from 'node:assert/strict';
import { World, Runner, ScriptOpcode, Scripts, types, id, inv, player, proc, add, count, use, load } from './runtime.mjs';

const OpHeldU = (await load('network/game/client/model/OpHeldU.ts')).default;
const OpHeldUHandler = (await load('network/game/client/handler/OpHeldUHandler.ts')).default;
const useHeldHandler = new OpHeldUHandler();
const inventoryComponent = id('Component', 'inventory:inv');

const families = [
  { seed: 'acorn', seedling: 'plantpot_acorn', watered: 'plantpot_acorn_watered', sapling: 'plantpot_oak_sapling' },
  { seed: 'willow_seed', seedling: 'plantpot_willow_seed', watered: 'plantpot_willow_seed_watered', sapling: 'plantpot_willow_sapling' },
  { seed: 'maple_seed', seedling: 'plantpot_maple_seed', watered: 'plantpot_maple_seed_watered', sapling: 'plantpot_maple_sapling' },
  { seed: 'yew_seed', seedling: 'plantpot_yew_seed', watered: 'plantpot_yew_seed_watered', sapling: 'plantpot_yew_sapling' },
  { seed: 'magic_tree_seed', seedling: 'plantpot_magic_tree_seed', watered: 'plantpot_magic_tree_seed_watered', sapling: 'plantpot_magic_tree_sapling' },
  { seed: 'spirit_tree_seed', seedling: 'plantpot_spirit_tree_seed', watered: 'plantpot_spirit_tree_seed_watered', sapling: 'plantpot_spirit_tree_sapling' },
  { seed: 'apple_tree_seed', seedling: 'plantpot_apple_seed', watered: 'plantpot_apple_seed_watered', sapling: 'plantpot_apple_sapling' },
  { seed: 'banana_tree_seed', seedling: 'plantpot_banana_seed', watered: 'plantpot_banana_seed_watered', sapling: 'plantpot_banana_sapling' },
  { seed: 'orange_tree_seed', seedling: 'plantpot_orange_seed', watered: 'plantpot_orange_seed_watered', sapling: 'plantpot_orange_sapling' },
  { seed: 'curry_tree_seed', seedling: 'plantpot_curry_seed', watered: 'plantpot_curry_seed_watered', sapling: 'plantpot_curry_sapling' },
  { seed: 'pineapple_tree_seed', seedling: 'plantpot_pineapple_seed', watered: 'plantpot_pineapple_seed_watered', sapling: 'plantpot_pineapple_sapling' },
  { seed: 'papaya_tree_seed', seedling: 'plantpot_papaya_seed', watered: 'plantpot_papaya_seed_watered', sapling: 'plantpot_papaya_sapling' },
  { seed: 'palm_tree_seed', seedling: 'plantpot_palm_seed', watered: 'plantpot_palm_seed_watered', sapling: 'plantpot_palm_sapling' },
  { seed: 'calquat_tree_seed', seedling: 'plantpot_calquat_seed', watered: 'plantpot_calquat_seed_watered', sapling: 'plantpot_calquat_sapling' }
];

function slotForId(p, objectId) {
  for (let slot = 0; slot < types.InvType.get(inv).size; slot++) {
    if (p.invGetSlot(inv, slot)?.id === objectId) return slot;
  }
  assert.fail(`missing inventory object id ${objectId}`);
}

function useHeld(p, target, used) {
  const targetId = id('ObjType', target);
  const usedId = id('ObjType', used);
  const accepted = useHeldHandler.handle(new OpHeldU(
    targetId, slotForId(p, targetId), inventoryComponent,
    usedId, slotForId(p, usedId), inventoryComponent
  ), p);
  assert(accepted, `${used} on ${target} was not accepted by the native item handler`);
}

function column(table, name) {
  const index = table.columnNames.indexOf(name);
  assert(index >= 0, `missing ${table.debugname} column ${name}`);
  return index;
}

function value(row, columns, name) {
  return row.getValue(columns[name], 0)[0];
}

export function runPotsCases(findPatch) {
  let cases = 0;
  const check = (name, action) => {
    try {
      action();
      cases++;
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  };

  check('all 14 original tree families have exact cached pot forms and target handlers', () => {
    const table = types.DbTableType.getByName('farming_pots');
    assert(table, 'compiled farming_pots table is required');
    const columns = Object.fromEntries(['seed', 'seedling', 'watered', 'sapling'].map(name => [name, column(table, name)]));
    const rows = types.DbRowType.getInTable(table.id);
    assert.equal(rows.length, families.length);
    const bySeed = new Map(rows.map(row => [value(row, columns, 'seed'), row]));
    assert.equal(bySeed.size, families.length, 'one row per original seed family');
    for (const crop of families) {
      const row = bySeed.get(id('ObjType', crop.seed));
      assert(row, `missing pot row for ${crop.seed}`);
      assert.equal(value(row, columns, 'seedling'), id('ObjType', crop.seedling));
      assert.equal(value(row, columns, 'watered'), id('ObjType', crop.watered));
      assert.equal(value(row, columns, 'sapling'), id('ObjType', crop.sapling));
      assert(Scripts.getByName(`[opheldu,${crop.seed}]`), `missing native seed target handler for ${crop.seed}`);
    }
    const growth = types.DbTableType.getByName('farming_growth');
    assert(growth, 'shared farming growth table is required');
    const growthColumns = { period: column(growth, 'period'), handler: column(growth, 'handler') };
    const rowsForPots = types.DbRowType.getInTable(growth.id)
      .filter(row => value(row, growthColumns, 'handler') === 10);
    assert.equal(rowsForPots.length, 1, 'one shared growth row dispatches potted saplings');
    assert.equal(value(rowsForPots[0], growthColumns, 'period'), 5, 'pots use the shared five-minute window');
  });


  for (const name of ['farming_veg_patch_1', 'farming_flower_patch_1', 'farming_herb_patch_1', 'farming_hops_patch_1',
    'farming_bush_patch_1', 'farming_cactus_patch', 'farming_belladonna_patch', 'farming_mushroom_patch',
    'farming_tree_patch_1', 'farming_fruit_tree_patch_1', 'farming_calquat_tree_patch', 'farming_spirit_tree_patch_1']) {
    check(`an empty pot fills through the native ${name} dispatch`, () => {
      const at = findPatch(name), p = player();
      p.x = at.x; p.z = at.z; p.level = at.loc.level;
      add(p, 'plantpot_empty'); add(p, 'gardening_trowel');
      const selector = types.LocType.get(at.loc.type).multivarbit;
      const before = p.getVarBit(selector);
      assert(use(p, 'plantpot_empty', at.loc));
      assert.equal(count(p, 'plantpot_empty'), 0); assert.equal(count(p, 'plantpot_compost'), 1);
      assert.equal(p.getVarBit(selector), before, 'taking soil does not alter the crop');
    });
  }
  check('taking soil without a gardening trowel preserves the empty pot', () => {
    const at = findPatch('farming_veg_patch_1'), p = player();
    p.x = at.x; p.z = at.z; p.level = at.loc.level; add(p, 'plantpot_empty');
    assert(use(p, 'plantpot_empty', at.loc));
    assert.equal(count(p, 'plantpot_empty'), 1); assert.equal(count(p, 'plantpot_compost'), 0);
  });

  for (const crop of families) for (let amount = 1; amount <= 5; amount++) {
    const sourceSeed = crop.seed;
    check(`${crop.seed} x${amount} plants, waters, and matures`, () => {
      const p = player();
      add(p, 'gardening_trowel');
      add(p, 'plantpot_compost');
      add(p, crop.seed, amount);
      if (amount % 2 === 0) useHeld(p, sourceSeed, 'plantpot_compost');
      else useHeld(p, 'plantpot_compost', sourceSeed);
      assert.equal(count(p, crop.seedling), 1, 'seedling replaces the filled pot');
      assert.equal(count(p, 'plantpot_compost'), 0);
      assert.equal(count(p, 'gardening_trowel'), 1);
      assert.equal(count(p, crop.seed), amount - 1, 'exactly one seed leaves the canonical inventory stack');
      proc(p, 'farming_pots_growth', 100);
      assert.equal(count(p, crop.seedling), 1, 'unwatered seedling does not mature');
      add(p, 'watering_can_8');
      useHeld(p, crop.seedling, 'watering_can_8');
      assert.equal(count(p, crop.watered), 1);
      assert.equal(count(p, 'watering_can_7'), 1, 'one can dose is spent');
      proc(p, 'farming_pots_growth', 0);
      assert.equal(count(p, crop.watered), 1, 'zero elapsed windows do not mature');
      proc(p, 'farming_pots_growth', 1);
      assert.equal(count(p, crop.watered), 0);
      assert.equal(count(p, crop.sapling), 1);
      proc(p, 'farming_pots_growth', 100);
      assert.equal(count(p, crop.sapling), 1, 'a sapling does not advance again');
    });
  }

  check('watering supports the reverse item-use direction and rejects an empty can', () => {
    const p = player();
    add(p, 'plantpot_acorn');
    add(p, 'watering_can_2');
    useHeld(p, 'watering_can_2', 'plantpot_acorn');
    assert.equal(count(p, 'plantpot_acorn'), 0);
    assert.equal(count(p, 'plantpot_acorn_watered'), 1);
    assert.equal(count(p, 'watering_can_1'), 1);
    const empty = player();
    add(empty, 'plantpot_acorn');
    add(empty, 'watering_can_0');
    useHeld(empty, 'plantpot_acorn', 'watering_can_0');
    assert.equal(count(empty, 'plantpot_acorn'), 1);
    assert.equal(count(empty, 'plantpot_acorn_watered'), 0);
    assert.equal(count(empty, 'watering_can_0'), 1);
  });

  check('planting without the reusable trowel preserves both seed and filled pot', () => {
    const p = player();
    add(p, 'plantpot_compost');
    add(p, 'acorn');
    useHeld(p, 'plantpot_compost', 'acorn');
    assert.equal(count(p, 'plantpot_compost'), 1);
    assert.equal(count(p, 'acorn'), 1);
    assert.equal(count(p, 'plantpot_acorn'), 0);
  });

  check('a watered seedling saved before logout matures on the next offline shared window', () => {
    const dateHandler = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
    let minute = 600;
    Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
    try {
      const p = player();
      proc(p, 'farming_login');
      add(p, 'gardening_trowel');
      add(p, 'plantpot_compost');
      add(p, 'acorn');
      add(p, 'watering_can_8');
      useHeld(p, 'plantpot_compost', 'acorn');
      useHeld(p, 'plantpot_acorn', 'watering_can_8');
      proc(p, 'farming_logout');
      const loaded = player(p.save());
      minute = 606;
      proc(loaded, 'farming_login');
      assert.equal(count(loaded, 'plantpot_acorn_watered'), 0);
      assert.equal(count(loaded, 'plantpot_oak_sapling'), 1);
      proc(loaded, 'farming_reconcile', 1);
      assert.equal(count(loaded, 'plantpot_oak_sapling'), 1, 'same-minute reconciliation is idempotent');
    } finally {
      Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = dateHandler;
    }
  });

  return cases;
}
