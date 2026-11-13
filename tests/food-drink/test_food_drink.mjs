// Execute packed opheld1 consumption dispatch without starting a world server.
// From the sibling engine: node --import tsx ../content/tests/food-drink/test_food_drink.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.resolve(process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack'));
const args = process.argv.slice(2);
const publishedMode = args.includes('--published');
const packOptionIndex = args.indexOf('--pack');
assert.ok(packOptionIndex === -1 || typeof args[packOptionIndex + 1] === 'string', '--pack requires a directory');
const requestedScriptPack = packOptionIndex === -1 ? pack : path.resolve(args[packOptionIndex + 1]);
const scriptPack = path.basename(requestedScriptPack) === 'server' ? path.dirname(requestedScriptPack) : requestedScriptPack;
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const ServerTriggerType = await load('engine/script/ServerTriggerType.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const { PlayerStatMap } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
    types[name] = await load(`cache/config/${name}.ts`);
    types[name].load(pack);
}
const DbTableIndex = await load('cache/config/DbTableIndex.ts');
DbTableIndex.init();
assert.ok(fs.existsSync(path.join(scriptPack, 'server/script.dat')), `full compiled server pack required at ${scriptPack}`);
assert.ok(ScriptProvider.load(scriptPack) > 0, 'ScriptProvider.load returned no compiled scripts');

const HITPOINTS = PlayerStatMap.get('HITPOINTS');
const ATTACK = PlayerStatMap.get('ATTACK');
const STRENGTH = PlayerStatMap.get('STRENGTH');
const invId = types.InvType.getId('inv');
const eatDelayVarp = types.VarPlayerType.getId('eat_delay');
const actionDelayVarp = types.VarPlayerType.getId('action_delay');
const humanEat = types.SeqType.getId('human_eat');
const kegDrink = types.SeqType.getId('viking_keg_drink_full');
const soundIds = new Map([...fs.readFileSync(path.join(content, 'pack/synth.pack'), 'utf8').matchAll(/^(\d+)=(.+)$/gm)].map(match => [match[2].trim(), Number(match[1])]));
const eatSound = soundIds.get('eat');
const liquidSound = soundIds.get('liquid');
assert.ok(kegDrink >= 0 && Number.isInteger(eatSound) && Number.isInteger(liquidSound), 'missing revision-377 keg or food presentation assets');
const bowlId = types.ObjType.getId('bowl_empty');
const breadId = types.ObjType.getId('bread');
for (const [name, id] of [['inventory', invId], ['eat_delay', eatDelayVarp], ['action_delay', actionDelayVarp], ['human_eat', humanEat], ['bowl_empty', bowlId], ['bread', breadId]]) {
    assert.ok(id >= 0, `missing packed config ${name}`);
}
assert.ok(Number.isInteger(HITPOINTS) && Number.isInteger(ATTACK) && Number.isInteger(STRENGTH), 'missing PlayerStat indices');
World.currentTick = 100;
World.gameMap.init();

const foods = [
    { name: 'tbwt_sliced_banana', objectId: 3162, heal: 2, published: 'missing' },
    { name: 'mort_slimey_eel_cooked', objectId: 3381, heal: [6, 10], published: 'meat' },
    { name: 'snail_corpse_cooked1', objectId: 3369, heal: [5, 7], published: 'meat' },
    { name: 'snail_corpse_cooked2', objectId: 3371, heal: [6, 8], published: 'meat' },
    { name: 'snail_corpse_cooked3', objectId: 3373, heal: [7, 9], published: 'meat' },
    { name: 'mm_monkey_nuts', objectId: 4012, heal: 4, published: 'missing' },
    { name: 'mm_monkey_bar', objectId: 4014, heal: 5, published: 'missing' },
    { name: 'mm_banana_stew', objectId: 4016, heal: 11, container: bowlId, published: 'missing' },
    { name: 'keg_of_beer', objectId: 3801, strength: [2, 10], attackDrain: [5, 50], published: 'missing' }
].map(food => {
    const id = types.ObjType.getId(food.name);
    assert.equal(id, food.objectId, `${food.name} object id changed`);
    const obj = types.ObjType.get(id);
    const option = String(obj.iop[0] ?? '').toLowerCase();
    assert.ok(option === 'eat' || option === 'drink', `${food.name} has no Eat or Drink op1: ${obj.iop[0]}`);
    return { ...food, id, obj };
});

let serial = 0;
let clock = 100;
function setTick(tick) {
    clock = tick;
    World.currentTick = tick;
}
function freshTick() {
    setTick(clock + 10);
    return clock;
}
function fixture({ hp = 40, baseHp = 99, attack = 20, baseAttack = 20, strength = 10, baseStrength = 10 } = {}) {
    const p = new Player(`food_drink_${++serial}`, BigInt(serial), BigInt(serial));
    p.uid = serial;
    p.pid = serial;
    p.slot = serial;
    p.vars.fill(0);
    p.packets = [];
    p.messages = [];
    p.animations = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.messages.push(text);
    p.wrappedMessageGame = p.messageGame;
    const playAnimation = p.playAnimation;
    p.playAnimation = function (anim, delay) {
        this.animations.push({ anim, delay });
        return playAnimation.call(this, anim, delay);
    };
    p.baseLevels[HITPOINTS] = baseHp;
    p.levels[HITPOINTS] = hp;
    p.baseLevels[ATTACK] = baseAttack;
    p.levels[ATTACK] = attack;
    p.baseLevels[STRENGTH] = baseStrength;
    p.levels[STRENGTH] = strength;
    p.getInventory(invId);
    return p;
}
function inventory(p) {
    return p.getInventory(invId);
}
function inventoryContents(p) {
    return inventory(p).itemsFiltered.map(({ id, count }) => [id, count]).sort((left, right) => left[0] - right[0]);
}
function assertContents(p, expected, message) {
    assert.deepEqual(inventoryContents(p), expected.slice().sort((left, right) => left[0] - right[0]), message);
}
function findTrigger(item) {
    // Match OpHeldHandler: the packed resolver checks an object, then its category, then the global trigger.
    return ScriptProvider.getByTrigger(ServerTriggerType.OPHELD1, item.id, item.obj.category);
}
function eat(p, item) {
    const script = findTrigger(item);
    if (!script) return null;
    const slot = inventory(p).getItemIndex(item.id);
    assert.notEqual(slot, -1, `${item.name} is absent from the held-item slot`);
    p.lastItem = item.id;
    p.lastSlot = slot;
    const result = p.runScript(ScriptRunner.init(script, p), true);
    assert.equal(result, ScriptState.FINISHED, `${item.name} opheld1 did not finish (${script.name})`);
    return script;
}
function withRandomDouble(next, action) {
    const original = JavaRandom.nextDouble;
    JavaRandom.nextDouble = next;
    try {
        return action();
    } finally {
        JavaRandom.nextDouble = original;
    }
}
function rangeFor(item) {
    return Array.isArray(item.heal) ? item.heal : [item.heal, item.heal];
}
function midHeal(item) {
    const [min, max] = rangeFor(item);
    return min + Math.floor((max - min + 1) / 2);
}
function assertDelays(p, tick, actionDelay = 3) {
    assert.equal(p.vars[eatDelayVarp], tick + 2, 'published two-tick eating delay');
    assert.equal(p.vars[actionDelayVarp], actionDelay, 'published three-tick action delay');
}
function assertPresentation(p, item, expectedCount = 1) {
    const isKeg = item.name === 'keg_of_beer';
    const animation = isKeg ? kegDrink : humanEat;
    assert.equal(p.animations.length, expectedCount, `${item.name} plays one consumption animation per successful Eat/Drink`);
    assert.ok(p.animations.every(({ anim, delay }) => anim === animation && delay === 0), `${item.name} uses its exact packed consumption animation`);
    const sounds = p.packets.filter(packet => packet.constructor?.name === 'SynthSound');
    assert.equal(sounds.length, expectedCount * (isKeg ? 2 : 1), `${item.name} emits its exact consumption sound count`);
    assert.ok(sounds.every(packet => packet.synth === (isKeg ? liquidSound : eatSound) && packet.loops === (isKeg ? 1 : 0) && packet.delay === 0), `${item.name} emits its exact packed sound`);
    if (isKeg) {
        assert.equal(p.messages.filter(text => text === 'You chug the keg. You feel reinvigorated...').length, expectedCount);
        assert.equal(p.messages.filter(text => text === '...but extremely drunk too.').length, expectedCount);
    } else {
        const genericLines = p.messages.filter(text => /^You (?:eat|drink) the /i.test(text));
        assert.equal(genericLines.length, expectedCount, `${item.name} uses the generic consumption message`);
    }
}
function assertItemOutcome(item, { hp = 40, baseHp = 99, random = 0.5 } = {}) {
    const isKeg = item.name === 'keg_of_beer';
    const p = fixture({ hp, baseHp, attack: isKeg ? 20 : 10, baseAttack: isKeg ? 20 : 10, strength: isKeg ? 99 : 10, baseStrength: isKeg ? 99 : 10 });
    const inv = inventory(p);
    inv.add(item.id, 1);
    const tick = freshTick();
    const script = withRandomDouble(() => random, () => eat(p, item));
    assert.ok(script, `missing packed opheld1 trigger for ${item.name}`);
    const [minHeal] = item.heal === undefined ? [0] : rangeFor(item);
    const expectedHeal = item.heal === undefined ? 0 : Array.isArray(item.heal) ? minHeal + Math.floor((item.heal[1] - minHeal + 1) / 2) : item.heal;
    assert.equal(p.levels[HITPOINTS], Math.min(baseHp, hp + expectedHeal), `${item.name} hitpoints`);
    assert.equal(p.levels[STRENGTH], isKeg ? 110 : 10, `${item.name} strength`);
    assert.equal(p.levels[ATTACK], isKeg ? 5 : 10, `${item.name} attack`);
    assert.equal(inv.getItemCount(item.id), 0, `${item.name} is consumed once`);
    assertContents(p, item.container ? [[item.container, 1]] : [], `${item.name} container and inventory result`);
    assertDelays(p, tick);
    assertPresentation(p, item);
    return p;
}
function assertCappedHealing(item) {
    const p = fixture({ hp: 98, baseHp: 99 });
    inventory(p).add(item.id, 1);
    const script = withRandomDouble(() => 0.5, () => eat(p, item));
    assert.ok(script, `missing packed opheld1 trigger for ${item.name}`);
    assert.equal(p.levels[HITPOINTS], 99, `${item.name} heal caps at base hitpoints`);
    assert.equal(inventory(p).getItemCount(item.id), 0, `${item.name} is consumed at the hitpoint cap`);
    assertContents(p, item.container ? [[item.container, 1]] : [], `${item.name} capped-heal container result`);
}
function assertFullHitpointsConsumption(item) {
    const isKeg = item.name === 'keg_of_beer';
    const p = fixture({ hp: 99, baseHp: 99, attack: isKeg ? 20 : 10, baseAttack: isKeg ? 20 : 10, strength: isKeg ? 99 : 10, baseStrength: isKeg ? 99 : 10 });
    inventory(p).add(item.id, 1);
    const script = withRandomDouble(() => 0, () => eat(p, item));
    assert.ok(script, `missing packed opheld1 trigger for ${item.name}`);
    assert.equal(p.levels[HITPOINTS], 99, `${item.name} does not exceed base hitpoints`);
    assert.equal(inventory(p).getItemCount(item.id), 0, `${item.name} is still consumed at full hitpoints`);
    assertContents(p, item.container ? [[item.container, 1]] : [], `${item.name} full-health container result`);
    if (isKeg) {
        assert.equal(p.levels[STRENGTH], 110, 'keg strength boost uses stat_boost base-level cap');
        assert.equal(p.levels[ATTACK], 5, 'keg attack drain uses stat_drain current-level rule');
    }
}
function assertEatingDelay(item) {
    const isKeg = item.name === 'keg_of_beer';
    const p = fixture({ hp: 40, baseHp: 99, attack: isKeg ? 20 : 10, baseAttack: isKeg ? 20 : 10, strength: isKeg ? 99 : 10, baseStrength: isKeg ? 99 : 10 });
    const inv = inventory(p);
    inv.add(item.id, 2);
    const tick = freshTick();
    const expectedFirstHeal = item.heal === undefined ? 0 : Array.isArray(item.heal) ? item.heal[0] : item.heal;
    withRandomDouble(() => 0, () => {
        assert.ok(eat(p, item), `missing packed opheld1 trigger for ${item.name}`);
        assert.equal(inv.getItemCount(item.id), 1, `${item.name} consumes one of two items`);
        assert.equal(p.levels[HITPOINTS], 40 + expectedFirstHeal, `${item.name} first heal`);
        assertDelays(p, tick);
        const afterFirst = {
            hp: p.levels[HITPOINTS],
            attack: p.levels[ATTACK],
            strength: p.levels[STRENGTH],
            eatDelay: p.vars[eatDelayVarp],
            actionDelay: p.vars[actionDelayVarp],
            packets: p.packets.length,
            messages: p.messages.length,
            animations: p.animations.length,
            contents: inventoryContents(p)
        };
        for (const attemptTick of [tick + 1, tick + 2]) {
            setTick(attemptTick);
            assert.ok(eat(p, item), `missing packed opheld1 trigger for ${item.name}`);
            assert.equal(p.levels[HITPOINTS], afterFirst.hp, `${item.name} does not heal inside eating delay`);
            assert.equal(p.levels[ATTACK], afterFirst.attack, `${item.name} does not change attack inside eating delay`);
            assert.equal(p.levels[STRENGTH], afterFirst.strength, `${item.name} does not change strength inside eating delay`);
            assert.equal(p.vars[eatDelayVarp], afterFirst.eatDelay, `${item.name} keeps eating delay after rejected Eat`);
            assert.equal(p.vars[actionDelayVarp], afterFirst.actionDelay, `${item.name} keeps action delay after rejected Eat`);
            assert.equal(inv.getItemCount(item.id), 1, `${item.name} leaves the second item during eating delay`);
            assert.deepEqual(inventoryContents(p), afterFirst.contents, `${item.name} does not create a container during eating delay`);
            assert.equal(p.packets.length, afterFirst.packets, `${item.name} emits no sound during eating delay`);
            assert.equal(p.messages.length, afterFirst.messages, `${item.name} emits no message during eating delay`);
            assert.equal(p.animations.length, afterFirst.animations, `${item.name} plays no animation during eating delay`);
        }
        setTick(tick + 3);
        assert.ok(eat(p, item), `missing packed opheld1 trigger for ${item.name}`);
        assert.equal(inv.getItemCount(item.id), 0, `${item.name} can be eaten after the two-tick delay`);
        assert.equal(p.vars[actionDelayVarp], 6, `${item.name} applies the three-tick skill delay again after cooldown`);
        assert.equal(p.vars[eatDelayVarp], tick + 5, `${item.name} starts a new two-tick eating delay`);
    });
}
function assertPublishedFoodControl() {
    const bread = { name: 'bread', id: breadId, obj: types.ObjType.get(breadId) };
    const p = fixture({ hp: 40, baseHp: 99 });
    inventory(p).add(bread.id, 1);
    const tick = freshTick();
    const script = eat(p, bread);
    assert.ok(script, 'published bread opheld1 trigger is present');
    assert.equal(p.levels[HITPOINTS], 44, 'published bread still heals its table value of four hitpoints');
    assert.equal(inventory(p).getItemCount(bread.id), 0, 'published bread is still consumed');
    assertContents(p, [], 'published bread leaves no container');
    assertDelays(p, tick);
    assertPresentation(p, bread);
    const cap = fixture({ hp: 98, baseHp: 99 });
    inventory(cap).add(bread.id, 1);
    assert.ok(eat(cap, bread));
    assert.equal(cap.levels[HITPOINTS], 99, 'published bread keeps its hitpoint cap');
    assert.equal(inventory(cap).getItemCount(bread.id), 0, 'published bread is consumed at the cap');
    const full = fixture({ hp: 99, baseHp: 99 });
    inventory(full).add(bread.id, 1);
    assert.ok(eat(full, bread));
    assert.equal(full.levels[HITPOINTS], 99, 'published bread remains capped at full hitpoints');
    assert.equal(inventory(full).getItemCount(bread.id), 0, 'published bread remains consumable at full hitpoints');
}
function assertPublishedHeadBehavior() {
    for (const item of foods) {
        const p = fixture({ hp: 40, baseHp: 99 });
        const inv = inventory(p);
        inv.add(item.id, 1);
        const tick = freshTick();
        const specific = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPHELD1, item.id, -1);
        const category = item.obj.category === -1 ? undefined : ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPHELD1, -1, item.obj.category);
        const selected = findTrigger(item);
        if (item.published === 'meat') {
            assert.equal(specific, undefined, `${item.name} had no published object trigger`);
            assert.ok(category, `${item.name} published meat-category trigger missing`);
            assert.equal(category.name, '[opheld1,_meat]', `${item.name} must use the generic meat fallback`);
            assert.equal(selected, category, `${item.name} opheld1 dispatch must fall back to its category`);
            assert.equal(eat(p, item), category);
            assert.equal(inv.getItemCount(item.id), 0, `${item.name} generic meat path consumes one item`);
            assert.equal(p.levels[HITPOINTS], 40, `${item.name} generic meat path has no heal row`);
            assertDelays(p, tick);
            assert.equal(p.animations.length, 1, `${item.name} published meat fallback animates`);
        } else {
            assert.equal(selected, undefined, `${item.name} has no published opheld1 trigger`);
            assert.equal(eat(p, item), null, `${item.name} published opheld1 dispatch is absent`);
            assert.equal(inv.getItemCount(item.id), 1, `${item.name} remains in inventory without a trigger`);
            assert.equal(p.levels[HITPOINTS], 40, `${item.name} published head does not heal`);
            assert.equal(p.vars[eatDelayVarp], 0, `${item.name} does not start an eating delay without a trigger`);
            assert.equal(p.vars[actionDelayVarp], 0, `${item.name} does not start an action delay without a trigger`);
            assert.equal(p.animations.length, 0, `${item.name} does not animate without a trigger`);
        }
    }
}

if (publishedMode) {
    assertPublishedHeadBehavior();
    assertPublishedFoodControl();
    console.log('PASS published baseline: four meat-category items consume without healing, five items have no trigger, and bread is unchanged');
    process.exit(0);
}

for (const item of foods) {
    assertItemOutcome(item);
    if (item.heal !== undefined) assertCappedHealing(item);
    assertFullHitpointsConsumption(item);
    assertEatingDelay(item);
}

for (const item of foods.filter(food => Array.isArray(food.heal))) {
    const [min, max] = item.heal;
    const span = max - min + 1;
    const p = fixture({ hp: 40, baseHp: 99 });
    const inv = inventory(p);
    const observed = new Set();
    let randomCalls = 0;
    withRandomDouble(() => ((randomCalls++ % span) + 0.5) / span, () => {
        for (let index = 0; index < 200; index++) {
            setTick(clock + 3);
            p.levels[HITPOINTS] = 40;
            inv.add(item.id, 1);
            assert.ok(eat(p, item), `missing packed opheld1 trigger for ${item.name}`);
            const healed = p.levels[HITPOINTS] - 40;
            const expected = min + (index % span);
            assert.ok(healed >= min && healed <= max, `${item.name} roll ${index} healed outside ${min}..${max}: ${healed}`);
            assert.equal(healed, expected, `${item.name} uses the engine random range at run ${index}`);
            observed.add(healed);
            assert.equal(inv.getItemCount(item.id), 0, `${item.name} consumes one item at run ${index}`);
            assertDelays(p, clock, 3 * (index + 1));
        }
    });
    assert.equal(randomCalls, 200, `${item.name} uses one engine random value per run`);
    assert.deepEqual([...observed].sort((a, b) => a - b), Array.from({ length: span }, (_, index) => min + index), `${item.name} covers each heal in its range`);
    assertPresentation(p, item, 200);
    console.log(`PASS ${item.name}: 200 JavaRandom.nextDouble stubs covered ${min}..${max}`);
}

assertPublishedFoodControl();
console.log('PASS all nine packed opheld1 foods/drink: healing, caps, containers, stats, delays and presentation');
console.log('PASS published bread control: heal, cap, consumption and presentation unchanged');
console.log('RESULT PASS packed food and drink consumption regressions');
process.exit(0);
