// Packed production scripts and native trigger resolution; no server starts.
process.env.NODE_MEMBERS = 'true';
process.env.NODE_XPRATE = '1';
process.env.NODE_RANDOM_EVENTS = 'false';
const R = await import('../mta/runtime.mjs');
const { assert, configs, player, give, count, run, obj, inv, worn, id, World, ScriptProvider, ScriptState, ServerTriggerType } = R;
const { default: testJailer } = await import('./jailer.mjs');
const SynthSound = (await R.load('network/game/server/model/SynthSound.ts')).default;
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function finish(p, state) {
    for (let i = 0; state.execution === ScriptState.SUSPENDED && i < 30; i++) {
        World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
        p.delayed = false;
        p.executeScript(state, true, true);
    }
    assert.equal(state.execution, ScriptState.FINISHED, state.script.name);
    return state;
}
function button(p, name) {
    const component = id('Component', name);
    const script = ScriptProvider.getByTriggerSpecific(ServerTriggerType.IF_BUTTON, component, -1);
    assert(script, `native IF_BUTTON dispatch: ${name}`);
    p.lastCom = component;
    return run(p, script);
}
const unlock = p => p.setVarBit(id('VarBitType', 'magictraining_bonespeaches'), 1);
function runes(p, nature = 2, earth = 4, water = 4) {
    if (nature) give(p, 'naturerune', nature);
    if (earth) give(p, 'earthrune', earth);
    if (water) give(p, 'waterrune', water);
}
const runeCounts = p => ['naturerune', 'earthrune', 'waterrune'].map(name => count(p, name));
const magicXp = p => p.stats[6];
function cast(p) { return finish(p, button(p, 'magic:com_559')); }
function eatPeach(p) {
    p.lastItem = obj('peach');
    p.lastSlot = p.getInventory(inv).getItemIndex(p.lastItem);
    assert(p.lastSlot >= 0);
    const script = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD1, p.lastItem, configs.ObjType.get(p.lastItem).category);
    assert(script, 'peach Eat resolves through its packed food category');
    finish(p, run(p, script));
}
function visual(p) {
    assert.equal(p.animId, id('SeqType', 'human_castbonestobananas'));
    assert.equal(p.spotanimId, id('SpotanimType', 'bonestobananas_casting'));
    assert.equal(p.spotanimHeight, 92);
    assert(p.packets.some(packet => packet instanceof SynthSound && packet.synth === 227), 'bone conversion sound');
}

check('original entitlement is permanent magictraining6 bit 22 and peach keeps original identity/options', () => {
    const bit = configs.VarBitType.get(id('VarBitType', 'magictraining_bonespeaches'));
    assert.equal(bit.basevar, id('VarPlayerType', 'magictraining6'));
    assert.equal(bit.startbit, 22);
    assert.equal(bit.endbit, 22);
    assert.equal(configs.VarPlayerType.get(bit.basevar).scope, configs.VarPlayerType.SCOPE_PERM);
    const peach = configs.ObjType.get(obj('peach'));
    assert.equal(peach.id, 6883);
    assert.equal(peach.tradeable, false);
    assert.equal(peach.iop[0], 'Eat');
    const p = player(); unlock(p);
    const restored = R.PlayerLoading.load(p.username, new R.Packet(p.save()), null);
    assert(restored);
    assert.equal(restored.getVarBit(bit.id), 1, 'unlock survives save/load');
});
check('locked cast costs no bones, runes or XP, including in the Graveyard', () => {
    for (const room of [false, true]) {
        const p = player(room ? { x: 3363, z: 9641, level: 1 } : {});
        if (room) run(p, '[proc,mta_graveyard_enter]');
        const bone = room ? 'magictraining_bones1' : 'bones';
        give(p, bone); runes(p);
        const xp = magicXp(p); cast(p);
        assert.equal(count(p, bone), 1);
        assert.equal(count(p, 'peach'), 0);
        assert.deepEqual(runeCounts(p), [2, 4, 4]);
        assert.equal(magicXp(p), xp);
        assert(p.messages.includes('You need to learn Bones to Peaches first.'));
        assert.equal(p.animId, -1);
    }
});
check('level, each rune shortage and absent/suitable-bones gates never debit the cast', () => {
    for (const scenario of ['level', 'nature', 'earth', 'water', 'empty', 'extra-bones']) {
        const p = player(); unlock(p);
        if (scenario !== 'empty' && scenario !== 'extra-bones') give(p, 'bones');
        if (scenario === 'extra-bones') for (const name of ['big_bones', 'bones_burnt', 'bat_bones', 'wolf_bones', 'dragon_bones', 'cert_bones']) give(p, name);
        runes(p, scenario === 'nature' ? 1 : 2, scenario === 'earth' ? 3 : 4, scenario === 'water' ? 3 : 4);
        if (scenario === 'level') p.levels[6] = 59;
        const before = runeCounts(p), xp = magicXp(p);
        const contents = p.getInventory(inv).items.map(item => item && [item.id, item.count]);
        cast(p);
        assert.deepEqual(runeCounts(p), before, scenario);
        assert.equal(magicXp(p), xp, scenario);
        assert.equal(count(p, 'peach'), 0, scenario);
        assert.deepEqual(p.getInventory(inv).items.map(item => item && [item.id, item.count]), contents, scenario);
    }
});
check('unlocked level-60 cast converts only ordinary bones with exact cost, 65 XP and effects', () => {
    const p = player(); unlock(p); p.levels[6] = 60;
    give(p, 'bones', 3); give(p, 'big_bones'); give(p, 'bones_burnt'); give(p, 'bat_bones'); give(p, 'wolf_bones');
    runes(p, 3, 5, 5);
    const xp = magicXp(p); cast(p);
    assert.equal(count(p, 'bones'), 0);
    assert.equal(count(p, 'peach'), 3);
    for (const bone of ['big_bones', 'bones_burnt', 'bat_bones', 'wolf_bones']) assert.equal(count(p, bone), 1);
    assert.deepEqual(runeCounts(p), [1, 1, 1]);
    assert.equal(magicXp(p) - xp, 650);
    visual(p);
    p.baseLevels[3] = 50; p.levels[3] = 20;
    eatPeach(p);
    assert.equal(p.levels[3], 28);
    assert.equal(count(p, 'peach'), 2);
});
check('full inventory conversion, staff substitution and combination runes use the common spell machinery', () => {
    const full = player(); unlock(full); runes(full, 3, 5, 5); give(full, 'bones', 25);
    cast(full); assert.equal(count(full, 'peach'), 25); assert.deepEqual(runeCounts(full), [1, 1, 1]);
    const staff = player(); unlock(staff);
    const staffId = obj('mud_battlestaff');
    staff.getInventory(worn).set(configs.ObjType.get(staffId).wearpos, { id: staffId, count: 1 });
    give(staff, 'bones'); runes(staff, 2, 0, 0);
    cast(staff); assert.equal(count(staff, 'peach'), 1); assert.deepEqual(runeCounts(staff), [0, 0, 0]);
    const combo = player(); unlock(combo); give(combo, 'bones'); give(combo, 'mudrune', 4); give(combo, 'naturerune', 2);
    cast(combo); assert.equal(count(combo, 'peach'), 1); assert.equal(count(combo, 'mudrune'), 0);
});
check('Bones to Bananas remains ordinary-only, level 15, one/two/two runes and 25 XP', () => {
    const p = player(); p.levels[6] = 15; give(p, 'bones', 2); give(p, 'big_bones'); runes(p, 1, 2, 2);
    const xp = magicXp(p); finish(p, button(p, 'magic:bones_to_bananas'));
    assert.equal(count(p, 'bones'), 0); assert.equal(count(p, 'big_bones'), 1); assert.equal(count(p, 'banana'), 2);
    assert.deepEqual(runeCounts(p), [0, 0, 0]); assert.equal(magicXp(p) - xp, 250); visual(p);
});
check('Graveyard peaches use all four bone yields, exact Peaches XP, normal eating and native chute deposit', () => {
    const p = player({ x: 3363, z: 9641, level: 1 }); unlock(p);
    run(p, '[proc,mta_graveyard_enter]');
    for (let tier = 1; tier <= 4; tier++) give(p, `magictraining_bones${tier}`, 2);
    runes(p); const xp = magicXp(p); cast(p);
    assert.equal(count(p, 'peach'), 20);
    for (let tier = 1; tier <= 4; tier++) assert.equal(count(p, `magictraining_bones${tier}`), 0);
    assert.deepEqual(runeCounts(p), [0, 0, 0]); assert.equal(magicXp(p) - xp, 650); visual(p);
    p.baseLevels[3] = 99; p.levels[3] = 50; eatPeach(p); assert.equal(p.levels[3], 58);
    finish(p, R.trigger(p, 'OPLOC1', R.loc('magictraining_grave_foodshute', 3363, 9640, 1), 'LocType'));
    assert.equal(count(p, 'peach'), 0);
    assert.equal(p.getVar(id('VarPlayerType', 'mta_graveyard_points')), 1);
    assert.equal(magicXp(p) - xp, 900, '65 cast +25 deposit XP');
    assert.equal(p.getVar(id('VarPlayerType', 'varp628_bits')) & 15, 3, '19 fruit leaves three toward next point');
});
check('insufficient Graveyard fruit space restores all bones with no payment or XP', () => {
    const p = player({ x: 3363, z: 9641, level: 1 }); unlock(p); run(p, '[proc,mta_graveyard_enter]');
    give(p, 'magictraining_bones4', 25); runes(p);
    const xp = magicXp(p); cast(p);
    assert.equal(count(p, 'magictraining_bones4'), 25); assert.equal(count(p, 'peach'), 0);
    assert.deepEqual(runeCounts(p), [2, 4, 4]); assert.equal(magicXp(p), xp);
});
check('locked Bunny Hop refuses and unlocked native button plays the original 377 sequence', () => {
    const locked = player();
    const state = button(locked, 'controls:com_86');
    assert.notEqual(state.execution, ScriptState.ABORTED);
    assert.equal(locked.animId, -1);
    assert(locked.packets.some(packet => Object.values(packet).some(value => String(value).includes('This emote can be unlocked by doing an Easter seasonal event.'))));
    const p = player(); p.setVarBit(id('VarBitType', 'emote_bunny_hop'), 1);
    finish(p, button(p, 'controls:com_86'));
    assert.equal(p.animId, 3866); assert.equal(p.animDelay, 20);
    const seq = configs.SeqType.get(p.animId);
    assert.equal(seq.frameCount, 45); assert.equal(seq.duration, 225);
    assert.equal(seq.replaceheldleft, 0); assert.equal(seq.replaceheldright, 0);
    console.log(`Bunny Hop cache sequence=${seq.id} frames=${seq.frameCount} duration20ms=${seq.duration} seconds=${seq.duration / 50}`);
});
await testJailer(R);
console.log(`RESULT PASS peaches-small: ${passed} magic/emote checks plus Jailer silent-option/death checks`);
process.exit(0);
