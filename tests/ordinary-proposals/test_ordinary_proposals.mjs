import assert from 'node:assert/strict';
import * as r from './runtime.mjs';

const total = (f, item) => f.p.invTotal(r.inv, r.id('ObjType', item));
const add = (f, item, count) => f.p.invAdd(r.inv, r.id('ObjType', item), count);
const reset = f => { f.events.length = 0; f.start = r.World.currentTick; };
const run = (f, slot, random = 0.999) => r.withRandom(random, () => {
    reset(f);
    const script = r.select(f, slot);
    assert(script, `native click dispatch: ${r.types.LocType.get(f.loc.type).debugname}:${slot}`);
    r.execute(f, script);
    return r.settle(f);
});
const button = (f, component) => {
    assert(new r.IfButtonHandler().handle(new r.IfButton(r.id('Component', component)), f.p), `native visible button ${component}`);
};
const normalized = trace => {
    const ticks = new Map();
    for (const row of trace) {
        const previous = ticks.get(row.tick);
        ticks.set(row.tick, { ...row, events: [...(previous?.events ?? []), ...row.events] });
    }
    return [...ticks.values()];
};
const actionParity = (station, kind, item, component, requested, held, random = 0.999) => {
    const actual = r.fixture(station);
    add(actual, item, held);
    run(actual, kind === 'spin' ? 2 : 1);
    assert.equal(actual.p.activeScript?.execution, r.State.PAUSEBUTTON, 'native chooser opens');
    if (component.endsWith(':com_4') || (kind === 'fire' && [5, 9, 13].some(n => component.endsWith(`:com_${n}`)))) {
        button(actual, component);
        assert.equal(actual.p.activeScript?.execution, r.State.COUNTDIALOG, 'Make-X uses the native count dialog');
        reset(actual);
        r.withRandom(random, () => {
            assert(new r.ResumePCountDialogHandler().handle(new r.ResumePCountDialog(requested), actual.p));
        });
    } else {
        reset(actual);
        r.withRandom(random, () => button(actual, component));
    }
    const actualTrace = r.withRandom(random, () => r.settle(actual));
    const control = r.fixture(kind === 'spin' ? 'spinningwheel' : 'potteryoven');
    add(control, item, held);
    const expectedTrace = r.withRandom(random, () => {
        const trace = [];
        for (let n = 0; n < Math.min(requested, held); n++) {
            r.execute(control, r.use(control, item, 0));
            trace.push(...r.settle(control));
        }
        return trace;
    });
    if (requested <= held) {
        assert.deepEqual(normalized(actualTrace), normalized(expectedTrace), `${station} ${item} repeats the entire published action trace`);
    } else {
        const end = actualTrace.at(-1), expected = expectedTrace.at(-1);
        assert.deepEqual(end.inventory, expected.inventory, 'exhaustion consumes only held materials');
        assert.deepEqual(end.xp, expected.xp, 'exhaustion gives only published XP');
        assert.equal(end.tick, expected.tick, 'exhaustion keeps published action delays');
        assert(actualTrace.flatMap(t => t.events).some(e => e[1] === 'game' && /run out of|any more/.test(e[2])), 'sourced exhaustion message');
    }
};

const stations = [
    ['spinningwheel', 2, 'Spin'], ['elf_village_spinning_wheel', 2, 'Spin'], ['viking_spinningwheel', 2, 'Spin'],
    ['potteryoven', 1, 'Fire'], ['fai_barbarian_pottery_oven', 1, 'Fire'], ['viking_potteryoven', 1, 'Fire'],
    ['blast_furnace_sink', 1, 'Fill-bucket']
];
let placementCount = 0;
for (const [name, slot, option] of stations) {
    const type = r.types.LocType.get(r.id('LocType', name));
    assert.equal(type.op[slot - 1], option, 'the cached option spelling and slot are unchanged');
    const rows = r.placements.filter(p => p.type === type.id);
    assert(rows.length > 0, 'original map placements exist');
    for (const row of rows) {
        const f = r.fixture(name, row);
        assert(r.select(f, slot), `${name} original placement has native dispatch`);
        placementCount++;
    }
}
for (const station of ['spinningwheel', 'elf_village_spinning_wheel', 'viking_spinningwheel']) {
    actionParity(station, 'spin', 'wool', 'skillmulti2:com_7', 1, 2);
    actionParity(station, 'spin', 'flax', 'skillmulti2:com_11', 1, 2);
}
for (const [component, requested] of [['skillmulti2:com_6', 5], ['skillmulti2:com_5', 10], ['skillmulti2:com_4', 3]]) {
    actionParity('spinningwheel', 'spin', 'wool', component, requested, requested);
}
actionParity('spinningwheel', 'spin', 'wool', 'skillmulti2:com_6', 5, 2);
for (const station of ['potteryoven', 'fai_barbarian_pottery_oven', 'viking_potteryoven']) {
    for (const [item, component] of [['pot_unfired', 'skillmulti3:com_8'], ['piedish_unfired', 'skillmulti3:com_12'], ['bowl_unfired', 'skillmulti3:com_16']]) {
        for (const random of [0, 0.999]) actionParity(station, 'fire', item, component, 1, 2, random);
    }
}
for (const [component, requested] of [['skillmulti3:com_7', 5], ['skillmulti3:com_6', 10], ['skillmulti3:com_5', 3]]) {
    actionParity('potteryoven', 'fire', 'pot_unfired', component, requested, requested);
}
actionParity('potteryoven', 'fire', 'pot_unfired', 'skillmulti3:com_7', 5, 2);
for (const [station, slot, channel] of [['viking_spinningwheel', 2, 'interface'], ['viking_potteryoven', 1, 'game']]) {
    const f = r.fixture(station);
    f.p.setVar(r.id('VarPlayerType', 'viking'), 0);
    add(f, 'wool', 1); add(f, 'pot_unfired', 1);
    const before = r.snapshot(f);
    const trace = run(f, slot);
    assert.deepEqual(trace.at(-1).inventory, before.inventory, 'permission refusal consumes no input');
    assert.deepEqual(trace.at(-1).xp, before.xp, 'permission refusal awards no XP');
    assert(trace.flatMap(t => t.events).some(e => e[1] === channel && JSON.stringify(e[2]).includes('Only Fremenniks may use this')), 'permission refusal uses its sourced channel');
}
for (const [station, slot, component] of [['spinningwheel', 2, 'skillmulti2:com_7'], ['potteryoven', 1, 'skillmulti3:com_8']]) {
    const f = r.fixture(station);
    run(f, slot); reset(f); button(f, component);
    const trace = r.settle(f);
    assert.equal(f.p.getInventory(r.inv).items.filter(Boolean).length, 0, 'empty chooser input creates nothing');
    assert(trace.flatMap(t => t.events).some(e => JSON.stringify(e).includes(station === 'spinningwheel' ? "You'll need wool" : "You don't have any pots")), 'sourced missing-material message');
}
const low = r.fixture('spinningwheel');
low.p.levels[12] = low.p.baseLevels[12] = 1;
add(low, 'flax', 2); run(low, 2); reset(low); button(low, 'skillmulti2:com_10');
const lowTrace = r.settle(low);
assert.equal(total(low, 'flax'), 2, 'shared level gate consumes no flax');
assert(lowTrace.flatMap(t => t.events).some(e => JSON.stringify(e).includes('You need level 10 Crafting')), 'shared level gate wording is retained');
const members = r.Environment.NODE_MEMBERS;
try {
    r.Environment.NODE_MEMBERS = false;
    const free = r.fixture('spinningwheel');
    add(free, 'flax', 2); run(free, 2); reset(free); button(free, 'skillmulti2:com_10');
    const trace = r.settle(free);
    assert.equal(total(free, 'flax'), 2, 'free-world flax selection consumes no input');
    assert.deepEqual(Array.from(free.p.stats), new Array(free.p.stats.length).fill(0), 'free-world flax selection awards no XP');
    assert(trace.flatMap(t => t.events).some(e => e[1] === 'game' && String(e[2]).includes('members')), 'membership refusal is a game message');
} finally {
    r.Environment.NODE_MEMBERS = members;
}

for (const row of r.placements.filter(p => p.type === r.id('LocType', 'blast_furnace_sink'))) {
    for (const full of [false, true]) {
        const actual = r.fixture('blast_furnace_sink', row), control = r.fixture('sink');
        for (const f of [actual, control]) {
            add(f, 'bucket_empty', 2);
            if (full) add(f, 'knife', 26);
        }
        const trace = run(actual, 1);
        reset(control);
        r.execute(control, r.use(control, 'bucket_empty', 0));
        assert.deepEqual(trace, r.settle(control), 'Fill-bucket is exactly the published sink water action, including full inventory');
        assert.equal(total(actual, 'bucket_water'), 1);
        assert.equal(total(actual, 'bucket_empty'), 1);
    }
    const empty = r.fixture('blast_furnace_sink', row);
    run(empty, 1);
    assert.equal(total(empty, 'bucket_water'), 0, 'no bucket creates no water');
}

const publicTiles = [[3016, 3256], [3016, 3261], [3084, 3256], [3087, 3261]];
for (const [x, z] of publicTiles) {
    const row = r.placements.find(p => p.type === r.id('LocType', 'draynor_wardrobe') && p.x === x && p.z === z && p.level === 0);
    assert(row, 'retained public wardrobe tile is in the original map');
    placementCount++;
    for (const random of [0, 0.999]) {
        const actual = r.fixture('draynor_wardrobe', row), control = r.fixture('spookywardrobe');
        assert.deepEqual(run(actual, 1, random), run(control, 1, 0.999), 'public Open uses the unchanged plain family animation and delay');
        assert.equal(actual.loc.type, r.id('LocType', 'draynor_wardrobe_open'), 'public wardrobe never exposes an unsourced skeleton');
        assert.equal(actual.loc.lifecycleTick, control.loc.lifecycleTick, 'public form uses the family restoration duration');
        reset(actual); reset(control);
        assert.deepEqual(run(actual, 2, random), run(control, 2, random), 'public Search is exactly published plain Search, including its junk branch');
        reset(actual); reset(control);
        assert.deepEqual(run(actual, 3), run(control, 3), 'public Close uses the unchanged family action');
        assert.equal(actual.loc.type, r.id('LocType', 'draynor_wardrobe'));
        reset(actual); reset(control);
        run(actual, 1, random); run(control, 1, 0.999);
        const duration = control.loc.lifecycleTick;
        assert.equal(actual.loc.lifecycleTick, duration);
        for (let tick = 0; tick < duration; tick++) { actual.loc.turn(); control.loc.turn(); }
        assert.equal(actual.loc.type, r.id('LocType', 'draynor_wardrobe'), 'native lifecycle restores the original public wardrobe');
        assert.equal(control.loc.type, r.id('LocType', 'spookywardrobe'));
    }
}
console.log(`ORDINARY_PROPOSALS_PASS built=8 original-placements=${placementCount} native-dispatch=true published-action-parity=true`);
process.exit(0);
