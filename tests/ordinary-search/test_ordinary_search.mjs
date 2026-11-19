import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async name => import(pathToFileURL(path.join(engine, `src/${name}.ts`)).href);
const World = (await load('engine/World')).default;
const Provider = (await load('engine/script/ScriptProvider')).default;
const Runner = (await load('engine/script/ScriptRunner')).default;
const State = (await load('engine/script/ScriptState')).default;
const Pointer = (await load('engine/script/ScriptPointer')).default;
const Player = (await load('engine/entity/Player')).default;
const Loc = (await load('engine/entity/Loc')).default;
const { EntityLifeCycle } = await load('engine/entity/EntityLifeCycle');
const OpLocHandler = (await load('network/game/client/handler/OpLocHandler')).default;
const OpLoc = (await load('network/game/client/model/OpLoc')).default;
const JavaRandom = (await load('util/JavaRandom')).default;
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  configs[name] = (await load(`cache/config/${name}`)).default;
  configs[name].load(pack);
}
(await load('cache/config/DbTableIndex')).default.init();
assert(Provider.load(pack) > 0, 'build the full pack first');
const { LocType, InvType, ObjType } = configs;
const manifest = JSON.parse(readFileSync(path.join(content, 'tests/ordinary-search/scope.json'), 'utf8'));
World.currentTick = 100;
World.gameMap.init();
const map = await load('engine/GameMap');
const id = (type, name) => { const value = type.getId(name); assert(value >= 0, `packed ${name}`); return value; };
const empty = {
  empty_crate: ['You search the crate but find nothing.'],
  empty_crates: ['You search the crates but find nothing of value.'],
  empty_boxes: ['There is nothing interesting in these boxes.'],
  bookcase: ['You search the bookcase...', 'None of them look very interesting.']
};
let serial = 0;
function fixture(row, name = row.name) {
  const type = LocType.getByName(name); assert(type, `packed ${name}`);
  const p = new Player(`search${++serial}`, BigInt(serial), BigInt(serial));
  p.x = p.originX = row.x - 1; p.z = p.originZ = row.z; p.level = row.level;
  p.vars.fill(0); p.isActive = true; p.getInventory(id(InvType, 'inv'));
  const loc = new Loc(row.level, row.x, row.z, type.width, type.length, EntityLifeCycle.RESPAWN, type.id, row.shape ?? 10, row.angle ?? 0);
  loc.isActive = true;
  const messages = []; p.messageGame = message => messages.push(message); p.write = () => {};
  return { p, loc, type, messages };
}
function select(f, slot) {
  const original = World.getLoc;
  World.getLoc = () => f.loc;
  try {
    assert(new OpLocHandler().handle(new OpLoc(slot, f.loc.x, f.loc.z, f.type.id), f.p));
    assert.strictEqual(f.p.target, f.loc);
    return f.p.getOpTrigger();
  } finally { World.getLoc = original; }
}
function execute(f, script, random = 0.99, onPause = null) {
  const original = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => random;
  try {
    const state = Runner.init(script, f.p, f.loc);
    state.pointerAdd(Pointer.ProtectedActivePlayer);
    f.p.executeScript(state, true, true);
    for (let step = 0; state.execution !== State.FINISHED && step < 30; step++) {
      if (state.execution === State.PAUSEBUTTON && onPause) onPause(state);
      else assert.equal(state.execution, State.SUSPENDED, `${script.name} only suspends for an expected delay`);
      World.currentTick = Math.max(World.currentTick + 1, f.p.delayedUntil);
      f.p.delayed = false;
      f.p.executeScript(state, true, true);
    }
    assert.equal(state.execution, State.FINISHED, `${script.name} finishes`);
  } finally { JavaRandom.nextDouble = original; }
}
for (const row of manifest.search) {
  const f = fixture(row);
  const selected = select(f, row.slot);
  assert.equal(selected?.name, `[oploc${row.slot},_${row.family}]`, `${row.name} selects its generic family`);
  const inv = f.p.getInventory(id(InvType, 'inv'));
  const before = [...inv.items];
  execute(f, selected, row.family === 'bookcase' ? 0 : 0.99);
  assert.deepEqual(f.messages, empty[row.family], `${row.name} gives the inherited empty result`);
  assert.deepEqual([...inv.items], before, `${row.name}: empty search gives no item`);
  console.log(`PASS generic Search ${row.name} -> ${selected.name}`);
}
for (const row of manifest.left) {
  const f = fixture(row);
  const selected = select(f, row.slot);
  for (const family of Object.keys(empty)) {
    assert.notEqual(selected?.name, `[oploc${row.slot},_${family}]`, `${row.name} is not joined to this suite's generic Search`);
    assert.notEqual(f.p.getApTrigger()?.name, `[aploc${row.slot},_${family}]`, `${row.name} has no generic Search approach`);
  }
}
for (const row of manifest.search.filter(row => row.family === 'bookcase')) {
  const results = [
    'None of them look very interesting.',
    'You find nothing to interest you.',
    "You don't find anything that you'd ever want to read.",
    "It's full of books, but none of them look very interesting."
  ];
  for (let index = 0; index < results.length; index++) {
    const f = fixture(row); execute(f, select(f, row.slot), (index + 0.1) / results.length);
    assert.deepEqual(f.messages, ['You search the bookcase...', results[index]]);
  }
}
for (const row of manifest.search.filter(row => row.family !== 'bookcase')) {
  const f = fixture(row);
  // Deterministic VM fixture: first zero selects the inherited junk branch, then gloves.
  const original = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => 0;
  try {
    const state = Runner.init(select(f, row.slot), f.p, f.loc);
    state.pointerAdd(Pointer.ProtectedActivePlayer);
    f.p.executeScript(state, true, true);
    for (let step = 0; state.execution !== State.FINISHED && step < 30; step++) {
      assert([State.SUSPENDED, State.PAUSEBUTTON].includes(state.execution));
      World.currentTick = Math.max(World.currentTick + 1, f.p.delayedUntil); f.p.delayed = false;
      f.p.executeScript(state, true, true);
    }
    assert.equal(state.execution, State.FINISHED);
    assert.equal(f.p.invTotal(id(InvType, 'inv'), id(ObjType, 'leather_gloves')), 1, `${row.name} inherits the existing reward path`);
  } finally { JavaRandom.nextDouble = original; }
}
const wizardOpening = "There's a large selection of books, the majority of which look fairly old. Some very strange names... You pick one at random :";
const wizardTitles = [
  'The Dark Arts of Magical Wands',
  "So you think you're a Mage? Volume 28",
  "Living with a Wizard Husband - a Housewife's Story",
  'The Life & Times of a Thingummywut by Traiborn the Wizard',
  "Fire, Earth and Water - What's it all about?",
  'How to become the Ultimate Wizard of the Universe',
  '101 Ways to Impress Your Mates with Magic',
  'Wind Strike for Beginners'
];
for (const row of manifest.specific ?? []) {
  for (const placement of row.placements) {
    const type = LocType.getByName(row.name);
    const approaches = [];
    for (let x = placement.x - 2; x <= placement.x + type.width + 2; x++) {
      for (let z = placement.z - 2; z <= placement.z + type.length + 2; z++) {
        if (!map.isMapBlocked(x, z, placement.level) && map.reachedLoc(placement.level, x, z, placement.x, placement.z, type.width, type.length, 1, placement.angle, placement.shape, type.forceapproach)) approaches.push([x, z]);
      }
    }
    assert(approaches.length, `${row.name} has an original collision-clear approach on floor ${placement.level}`);
    if (row.name === 'mm_bookcase') {
      for (const random of [0, 0.3, 0.6, 0.9]) {
        const f = fixture({ ...placement, name: row.name });
        const script = select(f, row.slot);
        assert.equal(script?.name, '[oploc2,mm_bookcase]', 'bamboo bookcases select their own Search, never the generic family');
        const inventory = [...f.p.getInventory(id(InvType, 'inv')).items];
        const vars = [...f.p.vars];
        execute(f, script, random);
        assert.deepEqual(f.messages, ['You find nothing to suit your reading tastes here.'], 'bamboo Search gives only its sourced message, never a generic line');
        assert.deepEqual([...f.p.getInventory(id(InvType, 'inv')).items], inventory, 'bamboo Search gives no item');
        assert.deepEqual([...f.p.vars], vars, 'bamboo Search writes no quest state');
      }
      console.log(`PASS bamboo Search ${placement.x},${placement.z},L${placement.level}`);
    }
  }
  if (row.name === 'mm_bookcase') continue;
  for (let index = 0; index < wizardTitles.length; index++) {
    const f = fixture({ ...row.placements[0], name: row.name });
    const script = select(f, row.slot);
    assert.equal(script?.name, `[oploc${row.slot},${row.name}]`, 'specific bookcases do not become generic empty searches');
    const inventory = [...f.p.getInventory(id(InvType, 'inv')).items];
    const vars = [...f.p.vars];
    const boxes = [];
    execute(f, script, (index + 0.1) / wizardTitles.length, state => {
      assert.match(configs.Component.get(f.p.modalChat).comName, /^message[1-5]$/, 'the source tbox is a native message box, not player/NPC dialogue');
      boxes.push(state.splitPages.flat().join(' ').replace(/\s+/g, ' ').trim());
    });
    assert.deepEqual(boxes, [wizardOpening, `'${wizardTitles[index]}'`, 'Interesting...']);
    assert.deepEqual([...f.p.getInventory(id(InvType, 'inv')).items], inventory, 'the book-title dialogue gives no item');
    assert.deepEqual([...f.p.vars], vars, 'the ordinary lore shelf writes no quest state');
  }
}
const { CollisionType } = await load('engine/routefinder/flags');
const inheritedChestRestoreTicks = 300; // UNKNOWN historical timing: unchanged published chest-family duration.
for (const pair of manifest.pairs) {
  const closed = LocType.getByName(pair.closed), opened = LocType.getByName(pair.opened);
  const partnerParam = id(configs.ParamType, 'chest_other');
  assert.equal(closed.params.get(partnerParam), opened.id, 'closed form names its exact cache partner');
  assert.equal(opened.params.get(partnerParam), closed.id, 'open form names its exact cache partner');
  assert.equal(closed.op[pair.openSlot - 1], 'Open');
  assert.equal(opened.op[pair.searchSlot - 1], 'Search');
  assert.equal(opened.op[pair.closeSlot - 1], 'Shut', 'retain the original client spelling and slot');
  const arrival = pair.publicArrival, reachable = new Set([`${arrival.x},${arrival.z}`]), pending = [[arrival.x, arrival.z]];
  assert(!map.isMapBlocked(arrival.x, arrival.z, arrival.level), 'published Zanaris arrival is walkable');
  for (let index = 0; index < pending.length; index++) {
    const [x, z] = pending[index];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
      if (nx < 2368 || nx > 2495 || nz < 4416 || nz > 4479 || reachable.has(key)) continue;
      if (map.canTravel(arrival.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) {
        reachable.add(key); pending.push([nx, nz]);
      }
    }
  }
  for (const row of pair.placements) {
    const originalType = LocType.getByName(row.name);
    const native = World.getLoc(row.x, row.z, row.level, originalType.id);
    assert(native, `${row.name} uses an original native placement`);
    const approaches = [];
    for (let x = row.x - 2; x <= row.x + 2; x++) for (let z = row.z - 2; z <= row.z + 2; z++) {
      if (reachable.has(`${x},${z}`) && !map.isMapBlocked(x, z, row.level)
          && map.reachedLoc(row.level, x, z, row.x, row.z, originalType.width, originalType.length, 1, row.angle, row.shape, originalType.forceapproach)) approaches.push([x, z]);
    }
    assert(approaches.length, `${row.name}@${row.x},${row.z} has an original-map route from the published public arrival`);
    const f = fixture(row); f.loc = native; [f.p.x, f.p.z] = approaches[0];
    const act = (type, slot, family) => {
      f.type = type; f.messages.length = 0;
      const script = select(f, slot);
      assert.equal(script?.name, `[oploc${slot},_${family}]`, `${row.name} selects the published ${family} operation`);
      execute(f, script);
      assert.strictEqual(World.getLoc(row.x, row.z, row.level, native.type), native, 'native map stores the changed form');
      assert.deepEqual([native.x, native.z, native.level, native.shape, native.angle], [row.x, row.z, row.level, row.shape, row.angle], 'swap preserves native placement geometry');
    };
    if (native.type === closed.id) act(closed, pair.openSlot, 'chest_closed');
    assert.equal(native.type, opened.id);
    const inventory = [...f.p.getInventory(id(InvType, 'inv')).items];
    act(opened, pair.searchSlot, 'chest_open');
    assert.deepEqual(f.messages, ['You find nothing.'], 'the chest uses the existing, explicitly guessed generic wording');
    assert.deepEqual([...f.p.getInventory(id(InvType, 'inv')).items], inventory);
    f.messages.length = 0;
    execute(f, select(f, pair.searchSlot), 0, () => {});
    assert.equal(f.p.invTotal(id(InvType, 'inv'), id(ObjType, 'leather_gloves')), 1, 'the chest retains the inherited random-junk item branch');
    act(opened, pair.closeSlot, 'chest_open');
    assert.equal(native.type, closed.id);
    if (originalType.id === opened.id) act(closed, pair.openSlot, 'chest_closed');
    assert.equal(native.type, originalType.id, 'Open/Shut round trip restores each original closed or placed-open form');
    assert(!native.isChanged());
    act(originalType, originalType.id === closed.id ? pair.openSlot : pair.closeSlot, originalType.id === closed.id ? 'chest_closed' : 'chest_open');
    assert.equal(native.lifecycleTick, inheritedChestRestoreTicks, 'use the unchanged family restoration duration');
    for (let tick = 1; tick <= inheritedChestRestoreTicks; tick++) {
      World.currentTick++; World.processZones();
      assert.equal(native.type === originalType.id, tick === inheritedChestRestoreTicks, 'native lifecycle restores at the inherited bound, not earlier');
      for (const zone of World.zonesTracking) zone.reset();
    }
    assert(!native.isChanged(), 'native lifecycle restores the original cache form');
    console.log(`PASS generic chest pair ${row.name}@${row.x},${row.z}: Open/Search/Shut, junk and native restoration`);
  }
}
console.log(`ORDINARY_SEARCH_PASS search=${manifest.search.length} specific=${manifest.specific.length} titles=${wizardTitles.length} left=${manifest.left.length} pairs=${manifest.pairs.length}`);
process.exit(0);
