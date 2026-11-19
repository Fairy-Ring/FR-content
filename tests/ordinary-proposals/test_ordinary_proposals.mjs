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
    const expectedEvents = [];
    const expectedTrace = r.withRandom(random, () => {
        const trace = [];
        for (let n = 0; n < Math.min(requested, held); n++) {
            r.execute(control, r.use(control, item, 0));
            const single = r.settle(control);
            expectedEvents.push(...single.flatMap(row => row.events).map(event => event.slice(1)));
            trace.push(single.at(-1));
        }
        return trace;
    });
    const interval = kind === 'spin' ? 4 : 6;
    const completed = Math.min(requested, held);
    assert.equal(actualTrace.at(-1).tick, interval * completed, 'counted batch retains the published per-item duration');
    for (let n = 1; n <= completed; n++) {
        const finish = actualTrace.find(row => row.tick === n * interval);
        assert(finish, `item ${n} has a finish observation`);
        assert.deepEqual(finish.inventory, expectedTrace[n - 1].inventory, `item ${n} consumes and produces exactly the published action`);
        assert.deepEqual(finish.xp, expectedTrace[n - 1].xp, `item ${n} awards exactly the published XP`);
        assert.equal(actual.p.levels[12], 99, 'the fixture retains level 99 after every award');
    }
    for (const row of actualTrace) {
        const made = Math.min(Math.floor(row.tick / interval), completed);
        const inputs = row.inventory.filter(Boolean).filter(([name]) => name === item).reduce((sum, [, count]) => sum + count, 0);
        assert.equal(inputs, held - made, `tick ${row.tick}: material changes only at an item finish`);
    }
    const actualEvents = actualTrace.flatMap(row => row.events)
        .filter(event => !(event[1] === 'game' && /run out of|any more/.test(event[2])))
        .map(event => event.slice(1));
    assert.deepEqual(actualEvents, expectedEvents, 'every item retains published animation, sound and message order');
    if (requested > held) {
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
for (const [item, component] of [['piedish_unfired', 'skillmulti3:com_11'], ['bowl_unfired', 'skillmulti3:com_15']]) {
    for (const random of [0, 0.999]) actionParity('potteryoven', 'fire', item, component, 5, 5, random);
}

// Real input order, including an interruption on the exact tick a finish is due.
for (const [station, kind, item, product, component, interval] of [
    ['spinningwheel', 'spin', 'wool', 'ball_of_wool', 'skillmulti2:com_6', 4],
    ['spinningwheel', 'spin', 'flax', 'bow_string', 'skillmulti2:com_10', 4],
    ['potteryoven', 'fire', 'pot_unfired', 'pot_empty', 'skillmulti3:com_7', 6]
]) {
    for (const random of kind === 'fire' ? [0, 0.999] : [0.999]) {
        const single = r.fixture(station);
        add(single, item, 1);
        const initialXp = single.p.stats[12];
        r.withRandom(random, () => { r.execute(single, r.use(single, item, 0)); r.settle(single); });
        const productPerItem = total(single, product), xpPerItem = single.p.stats[12] - initialXp;
        for (const cancel of ['walk', 'close-modal', 'interaction', 'logout-cleanup']) {
            for (let at = 0; at <= interval * 2 + 1; at++) {
                const f = r.fixture(station);
                add(f, item, 5); run(f, kind === 'spin' ? 2 : 1); reset(f);
                r.withRandom(random, () => button(f, component));
                const stop = () => {
                    if (cancel === 'walk') {
                        assert(new r.MoveClickHandler().handle(new r.MoveClick([{ x: f.p.x, z: f.p.z + 1 }], 0, false), f.p), `${kind} tick ${at}: real walk input is accepted`);
                    } else if (cancel === 'close-modal') f.p.closeModal();
                    else if (cancel === 'interaction') f.p.clearPendingAction();
                    else f.p.cleanup();
                };
                r.withRandom(random, () => {
                    if (at === 0) stop();
                    f.p.processQueues(); // Finish the button input's tick.
                    for (let tick = 1; tick <= at; tick++) r.step(f, tick === at ? stop : undefined);
                    assert.equal(f.p.weakQueue.head(), null, `${cancel}: clears every pending batch phase`);
                    const completed = Math.max(0, Math.floor((at - 1) / interval));
                    assert.equal(total(f, item), 5 - completed, `${kind} ${cancel} tick ${at}: unfinished material stays held`);
                    assert.equal(total(f, product), completed * productPerItem, 'only finished items give a product');
                    assert.equal(f.p.stats[12] - initialXp, completed * xpPerItem, 'only finished items give XP');
                    for (let tick = 0; tick < interval * 3; tick++) r.step(f);
                    assert.equal(total(f, item), 5 - completed, 'a cleared batch never restarts');
                    assert.equal(total(f, product), completed * productPerItem, 'no delayed duplicate product');
                    assert.equal(f.p.stats[12] - initialXp, completed * xpPerItem, 'no delayed duplicate XP');
                });
            }
        }
    }
}

// Raw events do not clear the engine's weak queue. Match the published leather
// pattern for queue retention and modal blocking, then require station safety.
for (const [station, slot, item, product, component, interval] of [
    ['spinningwheel', 2, 'wool', 'ball_of_wool', 'skillmulti2:com_6', 4],
    ['potteryoven', 1, 'pot_unfired', 'pot_empty', 'skillmulti3:com_7', 6]
]) {
    for (const event of ['damage', 'teleport', 'interface']) {
        for (let at = 1; at <= interval * 2; at++) {
            const f = r.fixture(station), leather = r.fixture(station);
            add(f, item, 5); run(f, slot); reset(f); button(f, component);
            for (const name of ['leather', 'thread', 'needle']) add(leather, name, 5);
            leather.p.enqueueScript(r.Provider.getByName('[queue,craft_leather_queue]'), 3, interval, [r.id('ObjType', 'leather_gloves'), 5]);
            f.p.processQueues(); leather.p.processQueues();
            const initialXp = f.p.stats[12];
            r.withRandom(0.999, () => {
                for (let tick = 1; tick <= at; tick++) {
                    const apply = target => {
                        if (event === 'damage') target.p.applyDamage(1, 1);
                        else if (event === 'teleport') target.p.teleport(target.p.x + 10, target.p.z, target.p.level);
                        else target.p.openMainModal(r.id('Component', 'glass_crafting'));
                        assert(target.p.weakQueue.head(), `${event} itself retains the published weak queue`);
                    };
                    // Keep both fixtures on the same World tick.
                    const before = r.World.currentTick;
                    r.step(f, tick === at ? () => apply(f) : undefined);
                    r.World.currentTick = before;
                    r.step(leather, tick === at ? () => apply(leather) : undefined);
                }
                const madeBeforeEvent = Math.floor((at - 1) / interval);
                if (event === 'interface') {
                    assert.equal(f.p.canAccess(), false); assert.equal(leather.p.canAccess(), false);
                    for (let tick = 0; tick < interval * 2; tick++) r.step(f);
                    assert.equal(total(f, item), 5 - madeBeforeEvent, 'modal blocks the station like leather');
                    f.p.closeModal(); leather.p.closeModal();
                }
                r.settle(f);
                const made = 5 - total(f, item);
                assert.equal(made, event === 'damage' ? 5 : madeBeforeEvent, `${event}: no remote or blocked finish`);
                assert.equal(total(f, product), made, 'each finished input produces exactly one item');
                const recipe = r.types.StructType.get(r.types.ObjType.get(r.id('ObjType', item)).params.get(r.id('ParamType', station === 'spinningwheel' ? 'crafting_spinning_struct' : 'crafting_pottery_struct')));
                assert.equal(f.p.stats[12] - initialXp, made * recipe.params.get(r.id('ParamType', 'productexp')), 'each finished input awards exactly its recipe XP');
            });
        }
    }
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
low.p.stats[12] = r.getExpByLevel(1);
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
    assert.deepEqual(Array.from(free.p.stats), new Array(free.p.stats.length).fill(r.getExpByLevel(99)), 'free-world flax selection awards no XP');
    assert(trace.flatMap(t => t.events).some(e => e[1] === 'game' && String(e[2]).includes('members')), 'membership refusal is a game message');
} finally {
    r.Environment.NODE_MEMBERS = members;
}

for (const row of r.placements.filter(p => p.type === r.id('LocType', 'blast_furnace_sink'))) {
    for (const [full, justArrived] of [[false, false], [true, false], [false, true], [true, true]]) {
        const actual = r.fixture('blast_furnace_sink', row), control = r.fixture('sink');
        if (justArrived) actual.p.lastMovement = control.p.lastMovement = r.World.currentTick;
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
const exitStages = [0, 10, 20, 30, 40, 50]; // Checked-out quest_troll.constant.
for (const name of ['troll_stronghold_top_exit_left', 'troll_stronghold_top_exit_right']) {
    const type = r.types.LocType.get(r.id('LocType', name));
    const rows = r.placements.filter(row => row.type === type.id);
    assert.equal(rows.length, 1, `${name} original interior copy`);
    const row = rows[0];
    assert.equal(row.level, 2, 'the added exit exists only inside, not on the surface');
    assert.equal(r.map.isMapBlocked(row.x - 1, row.z, row.level), false);
    assert(r.map.reachedLoc(row.level, row.x - 1, row.z, row.x, row.z, type.width, type.length, 1, row.angle, row.shape, type.forceapproach), 'original interior approach reaches exit');
    placementCount++;
    for (const stage of exitStages) {
        const expected = r.fixture('troll_stronghold_top_exit_mid');
        const actual = r.fixture(name, row);
        expected.p.setVar(r.id('VarPlayerType', 'troll_quest'), stage);
        actual.p.setVar(r.id('VarPlayerType', 'troll_quest'), stage);
        const before = [...actual.p.vars];
        assert.deepEqual(run(actual, 1), run(expected, 1), `${name} repeats the published middle action at quest stage ${stage}`);
        assert.deepEqual([actual.p.level, actual.p.x, actual.p.z], [0, 2840, 3690], 'finished-274 shared landing');
        assert.deepEqual([actual.p.level, actual.p.x, actual.p.z], [expected.p.level, expected.p.x, expected.p.z]);
        assert.deepEqual([...actual.p.vars], before, 'exit changes no quest state');
    }
}
assert.equal(r.map.isMapBlocked(2840, 3690, 0), false, 'published surface landing is standable');
assert(r.map.isLineOfWalk(0, 2840, 3690, 2841, 3690), 'published landing has an ordinary walking exit');

console.log(`ORDINARY_PROPOSALS_PASS built=10 original-placements=${placementCount} native-dispatch=true published-action-parity=true`);
process.exit(0);
