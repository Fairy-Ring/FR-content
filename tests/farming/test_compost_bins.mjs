/** Compiled compost-bin input, growth, persistence, and collection proof. Run from sibling engine:
 * node --import tsx ../content/tests/farming/test_compost_bins.mjs
 * Native item-on-loc and loc-option packets exercise packed visible-form dispatch.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  World, Runner, ScriptOpcode, PlayerStat, PlayerTimerType, Scripts,
  types, id, player, proc, add, count, click, load,
} from './runtime.mjs';

const gameMap = await load('engine/GameMap.ts');
const ServerTriggerType = (await load('engine/script/ServerTriggerType.ts')).default;
const ScriptVarType = (await load('cache/config/ScriptVarType.ts')).default;
const OpLocU = (await load('network/game/client/model/OpLocU.ts')).default;
const useHandler = new ((await load('network/game/client/handler/OpLocUHandler.ts')).default)();
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binNames = [
  'farming_compost_bin_1',
  'farming_compost_bin_2',
  'farming_compost_bin_3',
  'farming_compost_bin_4',
];
const parentPlacements = new Map(binNames.map(name => [name, []]));
for (const filename of fs.readdirSync(path.join(content, 'maps'))
  .filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort()) {
  const [, mapX, mapZ] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match) continue;
    const [, level, x, z, type] = match.map(Number);
    const name = types.LocType.get(type).debugname;
    if (!parentPlacements.has(name)) continue;
    const loc = World.getLoc(mapX * 64 + x, mapZ * 64 + z, level, type);
    assert(loc, `original map contains packed ${name}`);
    parentPlacements.get(name).push(loc);
  }
}

const varp511 = id('VarPlayerType', 'varp511_bits');
const varp511Type = types.VarPlayerType.get(varp511);
const bins = binNames.map((name, index) => {
  const parent = types.LocType.getByName(name);
  assert(parent, `packed compost parent ${name}`);
  const selector = types.VarBitType.get(parent.multivarbit);
  assert(selector, `${name} retains its original varp511 selector`);
  const placements = parentPlacements.get(name);
  assert(placements.length > 0, `original map placement for ${name}`);
  placements.sort((a, b) => a.x - b.x || a.z - b.z || a.level - b.level);
  const loc = placements[0];
  assert.equal(loc.type, parent.id, `${name} map placement uses its original parent form`);
  return { name, index, parent, selector, loc };
});

const varpBin = id('VarPlayerType', 'farming_growth_minute');
const actionDelayVarp = id('VarPlayerType', 'action_delay');
const inv = id('InvType', 'inv');
const binVarpValue = p => p.getVar(varp511);
const binState = (p, bin) => p.getVarBit(bin.selector.id);
const stateVector = p => bins.map(bin => binState(p, bin));
const farmingXp = p => p.stats[PlayerStat.FARMING];
const forbiddenSliceValues = new Set([63, 127, 128]);
let cases = 0;
let failures = 0;

function test(name, action) {
  cases++;
  try {
    action();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.stack ?? error}`);
  }
}

function setBinState(p, bin, value) {
  p.setVarBit(bin.selector.id, value);
}

function setPosition(p, bin) {
  const config = types.LocType.get(bin.loc.type);
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const x = bin.loc.x + dx, z = bin.loc.z + dz;
    if (gameMap.isMapBlocked(x, z, bin.loc.level)) continue;
    if (!gameMap.reachedLoc(bin.loc.level, x, z, bin.loc.x, bin.loc.z,
      config.width, config.length, 1, bin.loc.angle, bin.loc.shape, config.forceapproach)) continue;
    p.x = x; p.z = z; p.level = bin.loc.level;
    return;
  }
  assert.fail(`${bin.name} has no collision-valid adjacent approach`);
}

function fixture(bin) {
  const p = player();
  setPosition(p, bin);
  p.setVar(actionDelayVarp, 0);
  return p;
}

function discard(p) {
  delete World.players[p.pid];
}

function restore(saved) {
  const p = player(saved);
  // PlayerLoading derives a real name hash; the anonymous fixture's serial-only
  // UID cannot resolve a loaded player's inventory listener through World.
  const oldUid = p.uid;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | p.pid) >>> 0;
  for (const listener of p.invListeners) {
    if (listener.source === oldUid) listener.source = p.uid;
  }
  return p;
}

// RuneScript bit-range writes call Player.setVar for the base varp. Capturing
// that method records every complete varp511 value, not only the selected byte.
function watchVarp511(p, audits) {
  const originalSetVar = p.setVar;
  const writes = [];
  let active = true;
  p.setVar = function (varp, value) {
    const result = originalSetVar.call(this, varp, value);
    if (varp === varp511) writes.push(this.getVar(varp));
    return result;
  };
  const audit = {
    writes,
    close() {
      if (!active) return;
      p.setVar = originalSetVar;
      active = false;
    },
  };
  audits.push(audit);
  return audit;
}

function assertSafeVarp511Writes(audits) {
  for (const audit of audits) for (const raw of audit.writes) {
    const unsigned = raw >>> 0;
    for (const bin of bins) {
      const value = (unsigned >>> (bin.index * 8)) & 0xff;
      assert(!forbiddenSliceValues.has(value),
        `varp511 write ${unsigned} contains forbidden compost slice ${value} at ${bin.name}`);
    }
  }
}

function visibleForm(p, bin) {
  const state = binState(p, bin);
  assert(state >= 0 && state < bin.parent.multiloc.length,
    `${bin.name} state ${state} has a packed visible form`);
  const visibleId = bin.parent.multiloc[state];
  assert(visibleId >= 0, `${bin.name} state ${state} resolves a packed visible form`);
  return types.LocType.get(visibleId);
}

function assertVisibleForm(p, bin, suffix, option = null) {
  const prefix = bin.index === 2 ? 'compost_bin_dark_' : 'compost_bin_';
  const form = visibleForm(p, bin);
  assert.equal(form.debugname, `${prefix}${suffix}`,
    `${bin.name} state ${binState(p, bin)} selects its visible form`);
  if (option !== null) assert.equal(form.op[0], option, `${form.debugname} native option`);
  return form;
}

function assertVisibleTrigger(p, bin, trigger) {
  const form = visibleForm(p, bin);
  const script = Scripts.getByTrigger(trigger, form.id, form.category);
  assert(script, `${trigger} is registered for visible ${form.debugname}`);
  return form;
}

function nativeUse(p, bin, item, itemSlot = inventoryIds(p).indexOf(id('ObjType', item))) {
  assertVisibleTrigger(p, bin, ServerTriggerType.OPLOCU);
  setPosition(p, bin);
  p.originX = p.x; p.originZ = p.z;
  const packet = new OpLocU(bin.loc.x, bin.loc.z, bin.loc.type,
    id('ObjType', item), itemSlot, id('Component', 'inventory:inv'));
  assert(useHandler.handle(packet, p), `native ${item}-on-${bin.name} packet is accepted`);
  p.processInteraction();
}

function nativeClick(p, bin, option) {
  assertVisibleTrigger(p, bin, ServerTriggerType.OPLOC1);
  assert.equal(visibleForm(p, bin).op[0], option, `${bin.name} visible option is ${option}`);
  setPosition(p, bin);
  assert(click(p, bin.loc, 1), `native ${option} on ${bin.name} is accepted`);
}

function assertStateVector(p, expected, message) {
  assert.deepEqual(stateVector(p), expected, message);
}

function assertInventoryFull(p) {
  const capacity = types.InvType.get(inv).size;
  const occupied = Array.from({ length: capacity }, (_, index) => p.invGetSlot(inv, index))
    .filter(item => item !== null && item !== undefined).length;
  assert.equal(occupied, capacity, 'inventory is full');
}

function inventoryIds(p) {
  const capacity = types.InvType.get(inv).size;
  return Array.from({ length: capacity }, (_, index) => p.invGetSlot(inv, index)?.id ?? -1);
}

function addAndUse(p, bin, item, expectedState, audits) {
  add(p, item);
  const beforeItem = count(p, item);
  const beforeXp = farmingXp(p);
  const audit = audits.at(-1);
  const beforeWrites = audit.writes.length;
  nativeUse(p, bin, item);
  assert.equal(count(p, item), beforeItem - 1, `${item} is consumed once`);
  assert.equal(binState(p, bin), expectedState, `${bin.name} state after ${item}`);
  assert.equal(farmingXp(p), beforeXp, 'adding ingredients grants no XP');
  assert(audit.writes.length > beforeWrites, 'native input writes varp511');
}

function inputState(kind, countInBin) {
  if (kind === 'normal') return countInBin;
  if (kind === 'super') return 32 + countInBin;
  return 128 + countInBin;
}

function batchState(kind) {
  if (kind === 'normal') return { full: 15, closed: 64, rotted: 91, output: 30 };
  if (kind === 'super') return { full: 47, closed: 73, rotted: 92, output: 62 };
  return { full: 143, closed: 82, rotted: 93, output: 158 };
}

const growthTimerScript = Scripts.getByName('[timer,farming_growth]');
assert(growthTimerScript, 'compiled [timer,farming_growth] timer');
function loginGrowthTimer(p, atMinute) {
  minute = atMinute;
  proc(p, 'farming_login');
  assert.equal(p.getVar(varpBin), atMinute, 'login saves a positive shared growth checkpoint');
  const timer = p.timers.get(growthTimerScript.id);
  assert(timer && timer.interval > 0, 'farming_login installs the real NORMAL growth timer');
  return timer.interval;
}

function pulseGrowthTimer(p, interval, atMinute) {
  minute = atMinute;
  World.currentTick += interval;
  p.processTimers(PlayerTimerType.NORMAL);
  assert.equal(p.getVar(varpBin), atMinute, 'real NORMAL timer reconciles the shared clock');
}

const oldDateHandler = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
let minute = 0;
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
try {
  test('the four original permanent transmitted varp511 slices resolve native visible-form dispatch', () => {
    assert.equal(varp511Type.scope, types.VarPlayerType.SCOPE_PERM);
    assert.equal(varp511Type.transmit, true);
    const expectedOffsets = [0, 8, 16, 24];
    for (const bin of bins) {
      assert.equal(bin.selector.basevar, varp511, `${bin.name} uses original varp511`);
      assert.equal(bin.selector.startbit, expectedOffsets[bin.index], `${bin.name} starts in its original byte`);
      assert.equal(bin.selector.endbit, expectedOffsets[bin.index] + 7, `${bin.name} occupies one original byte`);
      const p = fixture(bin);
      const audits = [];
      const audit = watchVarp511(p, audits);
      try {
        const expected = [1, 33, 129, 2];
        expected[bin.index] = 0;
        bins.forEach((other, index) => setBinState(p, other, expected[index]));
        assertStateVector(p, expected, `${bin.name} begins with independent peer slices`);
        assertVisibleForm(p, bin, 'empty');
        const beforeXp = farmingXp(p);
        addAndUse(p, bin, 'weeds', 1, audits);
        expected[bin.index] = 1;
        assertStateVector(p, expected, `${bin.name} input preserves all other slices`);
        assert.equal(farmingXp(p), beforeXp, 'input has no XP');

        setBinState(p, bin, 15); // Explicit offline fixture for the full-form option dispatch.
        expected[bin.index] = 15;
        assertVisibleForm(p, bin, 'compostable_ready', 'Close');
        const beforeCloseXp = farmingXp(p);
        const beforeCloseWrites = audit.writes.length;
        nativeClick(p, bin, 'Close');
        expected[bin.index] = 64;
        assertStateVector(p, expected, `${bin.name} Close changes only its original slice`);
        assert(audit.writes.length > beforeCloseWrites, 'Close writes varp511');
        assert.equal(farmingXp(p), beforeCloseXp, 'Close grants no XP');

        const beforeOpenXp = farmingXp(p);
        const beforeOpenInventory = inventoryIds(p);
        const beforeOpenWrites = audit.writes.length;
        assertVisibleForm(p, bin, 'closed', 'Open');
        nativeClick(p, bin, 'Open');
        assertStateVector(p, expected, 'early Open preserves all four fields');
        assert.equal(audit.writes.length, beforeOpenWrites, 'early Open does not write varp511');
        assert.equal(farmingXp(p), beforeOpenXp, 'early Open grants no XP');
        assert.deepEqual(inventoryIds(p), beforeOpenInventory, 'early Open leaves inventory unchanged');
        assertSafeVarp511Writes(audits);
      } finally {
        audit.close();
        discard(p);
      }
    }
  });

  const normalIngredients = [
    'weeds', 'barley', 'hammerstone_hops', 'asgarnian_hops', 'jute_fibre',
    'yanillian_hops', 'krandorian_hops', 'wildblood_hops',
    'marigold', 'rosemary', 'nasturtium', 'woadleaf', 'limpwurt_root',
    'dwellberries', 'redberries', 'cadavaberries',
    'potato', 'cabbage', 'onion', 'tomato', 'strawberry', 'sweetcorn',
    'guam_leaf', 'marentill', 'tarromin', 'harralander', 'eadgar_goutweed_herb',
    'ranarr_weed', 'irit_leaf', 'cooking_apple', 'banana', 'orange', 'curry_leaf',
  ];
  const superIngredients = [
    'oak_roots', 'willow_roots', 'maple_roots', 'yew_roots', 'magic_roots',
    'pineapple', 'watermelon', 'coconut', 'papaya', 'bittercap_mushroom',
    'poisonivy_berries', 'jangerberries', 'white_berries',
    'avantoe', 'kwuarm', 'snapdragon', 'cadantine', 'lantadyme',
    'dwarf_weed', 'torstol', 'toadflax',
  ];
  const expectedIngredients = new Map();
  for (const name of normalIngredients) expectedIngredients.set(id('ObjType', name), name === 'tomato' ? 3 : 1);
  for (const name of superIngredients) expectedIngredients.set(id('ObjType', name), 2);

  test('the compiled ingredient enum contains exactly all 54 named cache objects and source classes', () => {
    const ingredientEnum = types.EnumType.getByName('farming_compost_ingredients');
    assert(ingredientEnum, 'compiled farming_compost_ingredients enum');
    assert.equal(ingredientEnum.inputtype, ScriptVarType.OBJ);
    assert.equal(ingredientEnum.outputtype, ScriptVarType.INT);
    assert.equal(ingredientEnum.defaultInt, 0, 'unlisted object kinds are refused by default');
    assert.equal(normalIngredients.length, 33);
    assert.equal(superIngredients.length, 21);
    assert.equal(expectedIngredients.size, 54);
    assert.equal(ingredientEnum.values.size, 54, 'enum has no missing or extra object values');
    const expected = [...expectedIngredients.entries()].sort((a, b) => a[0] - b[0]);
    const actual = [...ingredientEnum.values.entries()].sort((a, b) => a[0] - b[0]);
    assert.deepEqual(actual, expected, 'each exact cache object has its contract value');
  });

  const refusedIngredients = [
    'cert_guam_leaf', 'cert_marentill', 'cert_tomato', 'cert_pineapple',
    'unidentified_guam', 'unidentified_marentill', 'unidentified_tarromin',
    'unidentified_harralander', 'unidentified_ranarr', 'unidentified_irit',
    'unidentified_avantoe', 'unidentified_kwuarm', 'unidentified_cadantine',
    'unidentified_dwarf_weed', 'unidentified_torstol',
    'tomato_seed', 'flowers_waterfall_quest', 'cooked_chicken_undead',
    'bucket_empty', 'bucket_compost', 'bucket_supercompost', 'rotten_tomato',
  ];
  test('certificates, unidentified herbs, seeds, unrelated flowers, foods, and outputs default to refused', () => {
    const ingredientEnum = types.EnumType.getByName('farming_compost_ingredients');
    for (const name of refusedIngredients) {
      const object = id('ObjType', name);
      assert.equal(ingredientEnum.values.get(object) ?? ingredientEnum.defaultInt, 0,
        `${name} is not a compost ingredient enum value`);
    }
  });

  test('native item-on-bin dispatch refuses certificates and unidentified herbs without side effects', () => {
    const bin = bins[0];
    for (const item of ['cert_guam_leaf', 'unidentified_guam', 'bucket_empty', 'tomato_seed']) {
      const p = fixture(bin);
      const audits = [];
      const audit = watchVarp511(p, audits);
      try {
        add(p, item);
        const before = {
          states: stateVector(p),
          inventory: inventoryIds(p),
          itemCount: count(p, item),
          xp: farmingXp(p),
          writes: audit.writes.length,
        };
        nativeUse(p, bin, item);
        assertStateVector(p, before.states, `${item} leaves every bin slice unchanged`);
        assert.deepEqual(inventoryIds(p), before.inventory, `${item} remains in inventory`);
        assert.equal(count(p, item), before.itemCount);
        assert.equal(farmingXp(p), before.xp, `${item} grants no XP`);
        assert.equal(audit.writes.length, before.writes, `${item} refusal does not write varp511`);
        assertSafeVarp511Writes(audits);
      } finally {
        audit.close();
        discard(p);
      }
    }
  });

  test('bin state is isolated per player and survives native save/load', () => {
    const bin = bins[0];
    const owner = fixture(bin);
    const observer = fixture(bin);
    const ownerAudits = [];
    const observerAudits = [];
    const ownerAudit = watchVarp511(owner, ownerAudits);
    const observerAudit = watchVarp511(observer, observerAudits);
    let loaded = null;
    let loadedAudit = null;
    const loadedAudits = [];
    try {
      addAndUse(owner, bin, 'weeds', 1, ownerAudits);
      assert.equal(binState(observer, bin), 0, 'another player sees an independent empty bin');
      const saved = owner.save();
      ownerAudit.close();
      assertSafeVarp511Writes(ownerAudits);
      discard(owner);
      loaded = restore(saved);
      loadedAudit = watchVarp511(loaded, loadedAudits);
      assert.equal(binState(loaded, bin), 1, 'owner partial state survives native save/load');
      assert.equal(binState(observer, bin), 0, 'loading the owner does not affect another player');

      addAndUse(observer, bin, 'pineapple', 33, observerAudits);
      assert.equal(binState(observer, bin), 33, 'observer writes its own super-input slice');
      assert.equal(binState(loaded, bin), 1, 'observer input leaves owner state unchanged');
      assertSafeVarp511Writes(observerAudits);
      assertSafeVarp511Writes(loadedAudits);
    } finally {
      ownerAudit.close();
      observerAudit.close();
      loadedAudit?.close();
      discard(owner);
      discard(observer);
      if (loaded) discard(loaded);
    }
  });


  test('normal/super and tomato/non-tomato mixtures become normal in either order', () => {
    const mixtures = [
      ['weeds', 'pineapple'], ['pineapple', 'weeds'],
      ['tomato', 'pineapple'], ['pineapple', 'tomato'],
      ['tomato', 'weeds'], ['weeds', 'tomato'],
    ];
    const bin = bins[0];
    for (const [first, second] of mixtures) {
      const p = fixture(bin);
      const audits = [];
      const audit = watchVarp511(p, audits);
      try {
        const initialXp = farmingXp(p);
        const firstClass = expectedIngredients.get(id('ObjType', first));
        addAndUse(p, bin, first, inputState(firstClass === 3 ? 'tomato' : firstClass === 2 ? 'super' : 'normal', 1), audits);
        addAndUse(p, bin, second, 2, audits);
        assert.equal(count(p, first), 0);
        assert.equal(count(p, second), 0);
        assert.equal(farmingXp(p), initialXp, 'mixture input grants no XP');
        assertSafeVarp511Writes(audits);
      } finally {
        audit.close();
        discard(p);
      }
    }
  });

  const batches = [
    {
      kind: 'normal', label: 'normal compost', bin: bins[0],
      inputs: [
        'weeds', 'barley', 'hammerstone_hops', 'asgarnian_hops', 'jute_fibre',
        'yanillian_hops', 'wildblood_hops', 'marigold', 'rosemary', 'dwellberries',
        'redberries', 'cadavaberries', 'potato', 'cabbage', 'onion',
      ],
      savePartialAfter: 5, result: 'bucket_compost', xp: 45,
    },
    {
      kind: 'super', label: 'supercompost', bin: bins[1],
      inputs: [
        'oak_roots', 'willow_roots', 'maple_roots', 'yew_roots', 'magic_roots',
        'pineapple', 'watermelon', 'coconut', 'papaya', 'bittercap_mushroom',
        'poisonivy_berries', 'jangerberries', 'white_berries', 'avantoe', 'toadflax',
      ],
      savePartialAfter: 7, result: 'bucket_supercompost', xp: 85,
    },
    {
      kind: 'tomato', label: 'rotten tomatoes', bin: bins[2],
      inputs: Array(15).fill('tomato'),
      savePartialAfter: 14, result: 'rotten_tomato', xp: 85,
    },
  ];

  for (const batch of batches) {
    test(`${batch.label}: a sixteenth input leaves the full bin and inventory unchanged`, () => {
      const bin = batch.bin;
      const p = fixture(bin);
      const audits = [];
      const audit = watchVarp511(p, audits);
      try {
        for (const [index, item] of batch.inputs.entries()) {
          addAndUse(p, bin, item, inputState(batch.kind, index + 1), audits);
        }
        assert.equal(binState(p, bin), batchState(batch.kind).full);
        const item = batch.inputs[0];
        add(p, item);
        const before = {
          states: stateVector(p), inventory: inventoryIds(p), itemCount: count(p, item),
          xp: farmingXp(p), writes: audit.writes.length,
        };
        nativeUse(p, bin, item);
        assertStateVector(p, before.states, `${batch.label} sixteenth input preserves every bin byte`);
        assert.deepEqual(inventoryIds(p), before.inventory, 'no item is exchanged');
        assert.equal(count(p, item), before.itemCount, 'the extra ingredient is not consumed');
        assert.equal(farmingXp(p), before.xp, 'the refused input grants no XP');
        assert.equal(audit.writes.length, before.writes, 'the full bin is not written');
        assertSafeVarp511Writes(audits);
      } finally {
        audit.close();
        discard(p);
      }
    });
  }

  function runFullBatch(batch, baseMinute) {
    const bin = batch.bin;
    const state = batchState(batch.kind);
    const closeInput = inputState(batch.kind, 15);
    const audits = [];
    let p = fixture(bin);
    let audit = watchVarp511(p, audits);
    try {
      const initialXp = farmingXp(p);
      minute = baseMinute;
      for (let index = 0; index < batch.inputs.length; index++) {
        const item = batch.inputs[index];
        addAndUse(p, bin, item, inputState(batch.kind, index + 1), audits);
        if (index + 1 !== batch.savePartialAfter) continue;

        const partial = inputState(batch.kind, batch.savePartialAfter);
        const saved = p.save();
        audit.close();
        assertSafeVarp511Writes(audits);
        discard(p);
        p = restore(saved);
        audit = watchVarp511(p, audits);
        assert.equal(binState(p, bin), partial, 'partial input count survives native save/load');
        assert.equal(farmingXp(p), initialXp, 'partial batch saves without XP');
      }

      assert.equal(binState(p, bin), closeInput, 'the fifteenth input fills the bin');
      assertVisibleForm(p, bin, batch.kind === 'normal' ? 'compostable_ready'
        : batch.kind === 'super' ? 'supercompostable_ready' : 'tomatoes_ready', 'Close');
      const closeXp = farmingXp(p);
      const beforeCloseWrites = audit.writes.length;
      nativeClick(p, bin, 'Close');
      assert.equal(binState(p, bin), state.closed, 'Close begins the shared nine-step countdown');
      assert.equal(farmingXp(p), closeXp, 'Close grants no XP');
      assert(audit.writes.length > beforeCloseWrites, 'Close writes the native bin slice');

      // Save the closed stage with a positive checkpoint. A reload uses the real
      // farming_login and NORMAL timer; no bin state is seeded for these steps.
      minute = baseMinute;
      proc(p, 'farming_login');
      assert.equal(p.getVar(varpBin), baseMinute);
      const closedSave = p.save();
      audit.close();
      assertSafeVarp511Writes(audits);
      discard(p);
      p = restore(closedSave);
      audit = watchVarp511(p, audits);
      assert.equal(binState(p, bin), state.closed, 'closed state survives native save/load');
      assert.equal(p.getVar(varpBin), baseMinute, 'positive shared checkpoint survives native save/load');
      const timerInterval = loginGrowthTimer(p, baseMinute);
      const beforeClockXp = farmingXp(p);

      const beforeEarlyOpenWrites = audit.writes.length;
      const beforeEarlyOpenInventory = inventoryIds(p);
      assertVisibleForm(p, bin, 'closed', 'Open');
      nativeClick(p, bin, 'Open');
      assert.equal(binState(p, bin), state.closed, 'Open refuses before the bin rots');
      assert.equal(audit.writes.length, beforeEarlyOpenWrites, 'early Open leaves varp511 unwritten');
      assert.equal(farmingXp(p), beforeClockXp, 'waiting/open refusal grants no XP');
      assert.deepEqual(inventoryIds(p), beforeEarlyOpenInventory, 'early Open leaves inventory unchanged');

      for (let step = 1; step <= 9; step++) {
        pulseGrowthTimer(p, timerInterval, baseMinute + step * 5);
        const expected = step < 9 ? state.closed + step : state.rotted;
        assert.equal(binState(p, bin), expected, `shared NORMAL timer step ${step}`);
        assert.equal(farmingXp(p), beforeClockXp, `growth step ${step} grants no XP`);
        if (step === 8) {
          const beforeWrites = audit.writes.length;
          const beforeInventory = inventoryIds(p);
          nativeClick(p, bin, 'Open');
          assert.equal(binState(p, bin), state.closed + 8, 'the eighth step is still not ready');
          assert.equal(audit.writes.length, beforeWrites, 'second early Open writes no bin state');
          assert.deepEqual(inventoryIds(p), beforeInventory, 'second early Open leaves inventory unchanged');
        }
      }
      const elapsedMinutes = minute - baseMinute;
      assert(elapsedMinutes >= 40 && elapsedMinutes <= 50,
        `${batch.label} completes naturally online within 40–50 minutes (${elapsedMinutes})`);
      const rottedSave = p.save();
      audit.close();
      assertSafeVarp511Writes(audits);
      discard(p);
      p = restore(rottedSave);
      audit = watchVarp511(p, audits);
      assert.equal(binState(p, bin), state.rotted, 'rotted state survives native save/load');
      assert.equal(p.getVar(varpBin), baseMinute + 45, 'rotted shared checkpoint survives native save/load');
      assert.equal(farmingXp(p), beforeClockXp, 'rotted save/load grants no XP');

      nativeClick(p, bin, 'Open');
      assert.equal(binState(p, bin), state.output, 'rotted bin opens to its preserved output class');
      assert.equal(farmingXp(p), beforeClockXp, 'Open grants no XP');
      const outputSave = p.save();
      audit.close();
      assertSafeVarp511Writes(audits);
      discard(p);
      p = restore(outputSave);
      audit = watchVarp511(p, audits);
      assert.equal(binState(p, bin), state.output, 'output-ready state survives native save/load');
      assert.equal(count(p, batch.result), 0, 'no output exists before collection');
      const collectionXp = farmingXp(p);

      if (batch.kind === 'tomato') {
        for (let collected = 1; collected <= 15; collected++) {
          const beforeXp = farmingXp(p);
          const beforeWrites = audit.writes.length;
          assertVisibleForm(p, bin, collected === 1 ? 'rottentomatoes_ready' : 'rottentomatoes', 'Take-tomato');
          nativeClick(p, bin, 'Take-tomato');
          assert.equal(count(p, batch.result), collected, `one rotten tomato is added at action ${collected}`);
          assert.equal(binState(p, bin), collected === 15 ? 0 : state.output - collected,
            `one tomato output is removed at action ${collected}`);
          assert.equal(farmingXp(p) - beforeXp, batch.xp, `tomato collection XP is ${batch.xp} tenths`);
          assert(audit.writes.length > beforeWrites, 'tomato collection writes varp511');
        }
      } else {
        for (let collected = 1; collected <= 15; collected++) {
          add(p, 'bucket_empty');
          const beforeXp = farmingXp(p);
          const beforeWrites = audit.writes.length;
          nativeUse(p, bin, 'bucket_empty');
          assert.equal(count(p, 'bucket_empty'), 0, `one empty bucket is consumed at action ${collected}`);
          assert.equal(count(p, batch.result), collected, `one ${batch.result} is supplied at action ${collected}`);
          assert.equal(binState(p, bin), collected === 15 ? 0 : state.output - collected,
            `one bucket output is removed at action ${collected}`);
          assert.equal(farmingXp(p) - beforeXp, batch.xp, `collection XP is ${batch.xp} tenths`);
          assert(audit.writes.length > beforeWrites, 'bucket collection writes varp511');
        }
      }
      assert.equal(count(p, batch.result), 15, 'all fifteen outputs are collected exactly once');
      assert.equal(farmingXp(p) - collectionXp, batch.xp * 15, 'total collection XP is exact in tenths');
      assert.equal(binState(p, bin), 0, 'last output empties the bin');
      assertSafeVarp511Writes(audits);
    } finally {
      audit.close();
      discard(p);
    }
  }

  for (const [index, batch] of batches.entries()) {
    test(`${batch.label}: partial save, fifteen native inputs, nine shared timer steps, and every output`, () => {
      runFullBatch(batch, 1000 + index * 100);
    });
  }

  test('normal and super output refuse collection without a bucket, including a full inventory', () => {
    for (const batch of batches.filter(candidate => candidate.kind !== 'tomato')) {
      const bin = batch.bin;
      const state = batchState(batch.kind).output;
      for (const full of [false, true]) {
        const p = fixture(bin);
        const audits = [];
        const audit = watchVarp511(p, audits);
        try {
          setBinState(p, bin, state);
          if (full) {
            add(p, 'spade', types.InvType.get(inv).size);
            assertInventoryFull(p);
          } else {
            add(p, 'spade'); // A valid native item-on-loc attempt, but no empty bucket.
          }
          const before = {
            states: stateVector(p), inventory: inventoryIds(p), xp: farmingXp(p),
            writes: audit.writes.length,
          };
          nativeUse(p, bin, 'spade');
          assertStateVector(p, before.states, `${batch.label} refusal preserves all bin slices`);
          assert.deepEqual(inventoryIds(p), before.inventory, `${batch.label} refusal preserves inventory`);
          assert.equal(farmingXp(p), before.xp, `${batch.label} refusal grants no XP`);
          assert.equal(audit.writes.length, before.writes, `${batch.label} refusal writes no varp511 state`);
          assertSafeVarp511Writes(audits);
        } finally {
          audit.close();
          discard(p);
        }
      }
    }
  });

  test('normal and super collection replaces the selected bucket slot, including a full inventory', () => {
    for (const batch of batches.filter(candidate => candidate.kind !== 'tomato')) {
      for (const full of [false, true]) {
        const bin = batch.bin;
        const p = fixture(bin);
        const audits = [];
        const audit = watchVarp511(p, audits);
        try {
          setBinState(p, bin, batchState(batch.kind).output);
          const capacity = types.InvType.get(inv).size;
          const usedSlot = capacity - 1;
          add(p, 'spade', capacity);
          p.invSet(inv, id('ObjType', 'bucket_empty'), 1, 2);
          p.invSet(inv, id('ObjType', 'bucket_empty'), 1, usedSlot);
          if (full) assertInventoryFull(p);
          else p.invDel(inv, id('ObjType', 'spade'), 1, 0);
          const expectedInventory = inventoryIds(p);
          expectedInventory[usedSlot] = id('ObjType', batch.result);
          const expectedStates = stateVector(p);
          expectedStates[bin.index]--;
          const beforeXp = farmingXp(p);
          const beforeWrites = audit.writes.length;
          nativeUse(p, bin, 'bucket_empty', usedSlot);
          assert.deepEqual(inventoryIds(p), expectedInventory,
            `${batch.label} replaces the used slot, not the first bucket or first free slot`);
          assert.equal(count(p, 'bucket_empty'), 1, 'the other empty bucket remains');
          assert.equal(count(p, batch.result), 1, 'exactly one filled bucket is supplied');
          assertStateVector(p, expectedStates, 'only the selected output byte decrements once');
          assert.equal(farmingXp(p) - beforeXp, batch.xp, 'one collection grants the exact output XP');
          assert.equal(audit.writes.length, beforeWrites + 1, 'one successful transfer writes once');
          if (full) assertInventoryFull(p);
          assertSafeVarp511Writes(audits);
        } finally {
          audit.close();
          discard(p);
        }
      }
    }
  });

  test('rotten-tomato Take-tomato refuses a full inventory without changing output or XP', () => {
    const bin = batches.find(batch => batch.kind === 'tomato').bin;
    const p = fixture(bin);
    const audits = [];
    const audit = watchVarp511(p, audits);
    try {
      setBinState(p, bin, 158);
      add(p, 'spade', types.InvType.get(inv).size);
      assertInventoryFull(p);
      const before = {
        states: stateVector(p), inventory: inventoryIds(p), xp: farmingXp(p), writes: audit.writes.length,
      };
      nativeClick(p, bin, 'Take-tomato');
      assertStateVector(p, before.states, 'full inventory preserves rotten-tomato output');
      assert.deepEqual(inventoryIds(p), before.inventory, 'full inventory keeps all original items');
      assert.equal(count(p, 'rotten_tomato'), 0, 'no tomato is duplicated into a full inventory');
      assert.equal(farmingXp(p), before.xp, 'refused Take-tomato grants no XP');
      assert.equal(audit.writes.length, before.writes, 'full inventory refusal writes no varp511 state');
      assertSafeVarp511Writes(audits);
    } finally {
      audit.close();
      discard(p);
    }
  });

  test('positive saved offline checkpoint advances all four slices on login and finishes on NORMAL timers', () => {
    const initial = [64, 73, 82, 64];
    const expectedRotted = [91, 92, 93, 91];
    const p0 = fixture(bins[0]);
    const audits = [];
    let p = p0;
    let audit = watchVarp511(p, audits);
    try {
      bins.forEach((bin, index) => setBinState(p, bin, initial[index]));
      p.setVar(varpBin, 1000); // Explicit positive saved checkpoint for the offline fixture.
      const saved = p.save();
      audit.close();
      assertSafeVarp511Writes(audits);
      discard(p);
      p = restore(saved);
      audit = watchVarp511(p, audits);
      assert.deepEqual(stateVector(p), initial, 'all four closed forms survive native save/load');
      assert.equal(p.getVar(varpBin), 1000, 'positive checkpoint survives native save/load');

      const beforeXp = farmingXp(p);
      const interval = loginGrowthTimer(p, 1015);
      assert.deepEqual(stateVector(p), [66, 75, 84, 66],
        'real farming_login reconciles two completed offline five-minute windows');
      assert.equal(farmingXp(p), beforeXp, 'offline growth grants no XP');
      for (let step = 1; step <= 7; step++) {
        pulseGrowthTimer(p, interval, 1015 + step * 5);
        const completedSteps = 2 + step;
        const expected = initial.map((start, index) => completedSteps < 9
          ? start + completedSteps : expectedRotted[index]);
        assert.deepEqual(stateVector(p), expected, `shared NORMAL timer reaches step ${completedSteps}`);
        assert.equal(farmingXp(p), beforeXp, 'shared growth grants no XP');
      }
      assert.deepEqual(stateVector(p), expectedRotted, 'each bin class completes nine shared steps');

      for (const [index, bin] of bins.entries()) {
        nativeClick(p, bin, 'Open');
        assert.equal(binState(p, bin), [30, 62, 158, 30][index],
          `${bin.name} opens to its saved output type`);
      }
      assertSafeVarp511Writes(audits);
    } finally {
      audit.close();
      discard(p);
    }
  });

  test('shared reconcile uses integer RuneScript booleans for offline and online paths', () => {
    const p = fixture(bins[0]);
    const audits = [];
    const audit = watchVarp511(p, audits);
    try {
      setBinState(p, bins[0], 64);
      p.setVar(varpBin, 2000);
      minute = 2015;
      proc(p, 'farming_reconcile', 1);
      assert.equal(binState(p, bins[0]), 66, 'integer 1 selects actual offline reconciliation');
      assert.equal(p.getVar(varpBin), 2015);
      minute = 2020;
      proc(p, 'farming_reconcile', 0);
      assert.equal(binState(p, bins[0]), 67, 'integer 0 selects actual online reconciliation');
      assert.equal(p.getVar(varpBin), 2020);
      assertSafeVarp511Writes(audits);
    } finally {
      audit.close();
      discard(p);
    }
  });

  test('same shared logout/login clock can delay natural completion beyond fifty minutes', () => {
    const bin = bins[0];
    const p0 = fixture(bin);
    const audits = [];
    let p = p0;
    let audit = watchVarp511(p, audits);
    try {
      const closeAt = 3000;
      minute = closeAt;
      proc(p, 'farming_login');
      for (let input = 0; input < 15; input++) addAndUse(p, bin, 'weeds', input + 1, audits);
      assert.equal(binState(p, bin), 15);
      nativeClick(p, bin, 'Close');
      assert.equal(binState(p, bin), 64, 'native Close starts the real closed state');

      minute = closeAt + 4;
      proc(p, 'farming_logout');
      assert.equal(p.getVar(varpBin), closeAt + 4, 'logout saves the shared minute checkpoint');
      const saved = p.save();
      audit.close();
      assertSafeVarp511Writes(audits);
      discard(p);
      p = restore(saved);
      audit = watchVarp511(p, audits);
      assert.equal(binState(p, bin), 64, 'closed bin survives the logout save/load');
      assert.equal(p.getVar(varpBin), closeAt + 4, 'positive logout checkpoint survives native save/load');

      // DATE_MINUTES is integer-valued: close@3000, logout@3004, login@3009
      // retains the probe's same-clock missed-window pattern.
      const interval = loginGrowthTimer(p, closeAt + 9);
      assert.equal(binState(p, bin), 64, 'login has zero complete offline steps in this window');
      const beforeEarlyOpenWrites = audit.writes.length;
      const beforeEarlyOpenInventory = inventoryIds(p);
      nativeClick(p, bin, 'Open');
      assert.equal(binState(p, bin), 64, 'early Open after login remains refused');
      assert.equal(audit.writes.length, beforeEarlyOpenWrites);
      assert.deepEqual(inventoryIds(p), beforeEarlyOpenInventory, 'early Open leaves inventory unchanged');

      const beforeXp = farmingXp(p);
      for (let step = 1; step <= 9; step++) {
        pulseGrowthTimer(p, interval, closeAt + 9 + step * 5);
        const expected = step < 9 ? 64 + step : 91;
        assert.equal(binState(p, bin), expected, `logout-delay NORMAL timer step ${step}`);
        assert.equal(farmingXp(p), beforeXp, 'clock reconciliation grants no XP');
      }
      const elapsedMinutes = minute - closeAt;
      assert.equal(elapsedMinutes, 54, 'the integer shared-clock schedule completes at minute 54');
      assert(elapsedMinutes > 50, 'a short logout may delay completion beyond the period guide range');
      assertSafeVarp511Writes(audits);
    } finally {
      audit.close();
      discard(p);
    }
  });

  test('the shared growth row and named bin procedure are registered', () => {
    const growth = types.DbTableType.getByName('farming_growth');
    assert(growth, 'compiled farming_growth table');
    const handlerColumn = growth.columnNames.indexOf('handler');
    const periodColumn = growth.columnNames.indexOf('period');
    assert(handlerColumn >= 0, 'farming_growth handler column');
    assert(periodColumn >= 0, 'farming_growth period column');
    const rows = types.DbRowType.getInTable(growth.id);
    const binRows = rows.filter(row => row.getValue(handlerColumn, 0)[0] === 5);
    assert.equal(binRows.length, 1, 'one shared dispatch case 5 row');
    assert.equal(binRows[0].getValue(periodColumn, 0)[0], 5, 'compost bin row period is five minutes');
    assert(Scripts.getByName('[proc,farming_compost_growth]'), 'compiled farming_compost_growth(steps) entry');
  });
} finally {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = oldDateHandler;
}

console.log(`Compost-bin compiled checks: ${cases - failures}/${cases} passed`);
process.exit(failures ? 1 : 0);
