// Packed production safe-jump regression; no world server is started.
// From the sibling engine: node --import tsx ../content/tests/small-repairs/test_r4_teleport.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
    types[name] = await load(`cache/config/${name}.ts`);
    types[name].load(pack);
}
assert.ok(ScriptProvider.load(pack) > 0, 'full compiled pack required');
World.currentTick = 100;
World.gameMap.init();
const packedId = (file, name) => {
    const match = fs.readFileSync(path.join(content, 'pack', file), 'utf8').match(new RegExp(`^(\\d+)=${name}$`, 'm'));
    assert.ok(match, `missing ${file} ${name}`);
    return Number(match[1]);
};
const id = (kind, name) => {
    const value = types[kind].getId(name);
    assert.ok(value >= 0, `missing ${kind} ${name}`);
    return value;
};
const inv = id('InvType', 'inv');
const worn = id('InvType', 'worn');
const varp = name => id('VarPlayerType', name);
const obj = name => id('ObjType', name);
const followerUid = varp('fenk_follower_uid');
const directions = id('VarBitType', 'fenk_gardener_directions');
const doors = varp('ernestdoors');
const lever = varp('ernestlever');
const templeOverlay = packedId('interface.pack', 'flamtaer_status');
const destination = (0 << 28) | (3210 << 14) | 3210;
let serial = 0;
const fixtures = [];
function fixture(x = 3221, z = 3217) {
    const name = BigInt(++serial);
    const player = new Player(`r4_teleport_${serial}`, name, name);
    const slot = World.getNextPlayerSlot();
    assert.ok(slot > 0, 'free player slot required');
    player.slot = slot; player.pid = slot; player.uid = (Number(name) << 11) | slot;
    World.players[slot] = player;
    fixtures.push(player);
    player.vars.fill(0);
    player.setVar(followerUid, -1);
    player.levels.fill(40); player.baseLevels.fill(40);
    player.x = x; player.z = z; player.level = 0;
    player.events = [];
    player.messages = [];
    player.write = packet => player.events.push(['packet', packet.constructor.name, packet]);
    player.messageGame = text => { player.events.push(['message', text]); player.messages.push(text); };
    player.wrappedMessageGame = player.messageGame;
    player.teleport = function (...args) {
        this.events.push(['jump', this.overlay]);
        return Player.prototype.teleport.apply(this, args);
    };
    player.playAnimation = function (...args) {
        this.events.push(['animation', ...args]);
        return Player.prototype.playAnimation.apply(this, args);
    };
    player.setVar = function (...args) {
        this.events.push(['var', ...args]);
        return Player.prototype.setVar.apply(this, args);
    };
    player.invDel = function (...args) {
        this.events.push(['delete', ...args]);
        return Player.prototype.invDel.apply(this, args);
    };
    return player;
}
function run(player, name, args = []) {
    const script = ScriptProvider.getByName(name);
    assert.ok(script, `packed ${name} missing`);
    const state = ScriptRunner.init(script, player, undefined, args);
    assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${name} completes`);
    return state;
}
function jump(player) {
    player.events.length = 0;
    player.messages.length = 0;
    run(player, '[proc,p_telejump_safe]', [destination]);
}
const add = (player, name, count = 1) => player.invAdd(inv, obj(name), count);
const total = (player, name) => player.invTotal(inv, obj(name));
const failures = [];
function check(name, test) {
    try { test(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
}

check('camera reset follows jump and precedes animation clear', () => {
    const player = fixture();
    jump(player);
    assert.deepEqual([player.x, player.z, player.level], [3210, 3210, 0]);
    const jumpAt = player.events.findIndex(event => event[0] === 'jump');
    const resetAt = player.events.findIndex(event => event[0] === 'packet' && event[1] === 'CamReset');
    const animAt = player.events.findIndex(event => event[0] === 'animation' && event[1] === -1);
    assert.ok(jumpAt >= 0 && resetAt > jumpAt && animAt > resetAt, JSON.stringify(player.events.map(event => event.slice(0, 2))));
    assert.equal(player.events.filter(event => event[0] === 'packet' && event[1] === 'CamReset').length, 1);
});
check('existing Mortton mapzoneexit owns overlay closure', () => {
    const player = fixture(54 * 64 + 40, 51 * 64 + 48);
    player.overlay = templeOverlay; // Labelled packed fixture: existing temple-overlay state.
    jump(player);
    assert.equal(player.overlay, templeOverlay, 'safe jump does not duplicate the existing zone-exit owner');
    run(player, '[mapzoneexit,0_54_51]');
    assert.equal(player.overlay, -1, 'the existing compiled Mortton exit closes the overlay');
    const outside = fixture();
    outside.overlay = templeOverlay;
    jump(outside);
    assert.equal(outside.overlay, templeOverlay, 'an unrelated origin does not close an overlay');
});
check('haunted lever and door state reset before rum destruction', () => {
    const player = fixture();
    player.setVar(doors, 31); player.setVar(lever, 17); // Labelled puzzle-state precondition.
    add(player, 'karamja_rum', 2);
    jump(player);
    assert.equal(player.getVar(doors), 0);
    assert.equal(player.getVar(lever), 0);
    const resetAt = player.events.findIndex(event => event[0] === 'var' && event[1] === lever && event[2] === 0);
    const rumAt = player.events.findIndex(event => event[0] === 'delete' && event[2] === obj('karamja_rum'));
    assert.ok(resetAt >= 0 && rumAt > resetAt, 'donor puzzle-before-rum order');
});
const peerItems = [
    'viking_pointless_magnet', 'viking_pointless_thread', 'viking_pointless_pick', 'viking_pointless_shiptoy',
    'viking_bucket_5', 'viking_bucket_4', 'viking_bucket_3', 'viking_bucket_2', 'viking_bucket_1', 'viking_bucket_empty', 'viking_bucket_frozen',
    'viking_jug_3', 'viking_jug_2', 'viking_jug_1', 'viking_jug_empty', 'viking_jug_frozen',
    'viking_airtight_vase', 'viking_airtight_vase_water', 'viking_airtight_vase_frozen', 'viking_vase_lid',
    'viking_airtight_vase_with_lid', 'viking_airtight_vase_with_lid_frozen', 'viking_airtight_vase_with_lid_water',
    'viking_key_in_ice', 'viking_red_herring', 'viking_red_wooden_coin', 'viking_uncoloured_wooden_coin', 'viking_key', 'viking_red_splat'
];
check('every existing Peer trial item is removed, ordinary inventory is preserved', () => {
    for (const name of peerItems) {
        const player = fixture();
        add(player, name); add(player, 'coins', 123);
        assert.equal(total(player, name), 1, `fixture adds ${name}`);
        jump(player);
        assert.equal(total(player, name), 0, `${name} cleared`);
        assert.equal(total(player, 'coins'), 123, 'ordinary coins kept');
    }
});
check('backpack monkey removal follows Peer cleanup and deletes every monkey', () => {
    const player = fixture();
    add(player, 'viking_pointless_magnet'); add(player, 'mm_monkey_in_backpack', 2);
    jump(player);
    assert.equal(total(player, 'mm_monkey_in_backpack'), 0);
    assert.ok(player.messages.includes('The monkey in your backpack disappears in a puff of smoke!'));
    const peerAt = player.events.findIndex(event => event[0] === 'delete' && event[2] === obj('viking_red_splat'));
    const monkeyAt = player.events.findIndex(event => event[0] === 'delete' && event[2] === obj('mm_monkey_in_backpack'));
    assert.ok(peerAt >= 0 && monkeyAt > peerAt, 'donor Peer-before-monkey order');
});
check('sample no longer skips existing sled and later Peer cleanup', () => {
    const player = fixture();
    add(player, 'karamja_rum'); add(player, 'plaguesample'); add(player, 'viking_pointless_magnet');
    const sled = obj('trollromance_toboggon_waxed');
    player.invSet(worn, sled, 1, 3); // Existing right-hand sled precondition.
    jump(player);
    assert.equal(total(player, 'karamja_rum'), 0);
    assert.equal(total(player, 'plaguesample'), 0);
    assert.equal(player.invTotal(worn, sled), 0);
    assert.equal(total(player, 'trollromance_toboggon_waxed'), 1, 'existing free-space unequip outcome');
    assert.equal(total(player, 'viking_pointless_magnet'), 0);
    assert.deepEqual(player.messages, ['Your Karamjan rum gets broken and spilled.', 'The plague sample is too delicate...it disintegrates in the crossing.', 'You remove the sled.']);
});
check('existing full-inventory sled outcome is unchanged', () => {
    const player = fixture();
    player.invSet(worn, obj('trollromance_toboggon_waxed'), 1, 3);
    for (let slot = 0; slot < 28; slot++) player.invSet(inv, obj('knife'), 1, slot);
    jump(player);
    assert.equal(player.invTotal(worn, obj('trollromance_toboggon_waxed')), 0);
    assert.equal(total(player, 'trollromance_toboggon_waxed'), 0);
    assert.equal(total(player, 'knife'), 28);
    assert.deepEqual(player.messages, ['You drop the sled.']);
});
check('existing Fenkenstrain owned-follow lifecycle still runs', () => {
    const player = fixture(3557, 3555);
    run(player, '[proc,fenk_start_gardener_follow]');
    assert.notEqual(player.getVar(followerUid), -1, 'real packed writer creates follower');
    assert.equal(player.getVarBit(directions), 1);
    jump(player);
    assert.equal(player.getVar(followerUid), -1);
    assert.equal(player.getVarBit(directions), 0);
    assert.ok(player.messages.includes('The gardener ghost stops following you.'));
});
check('existing zero-HP, Castle Wars game and waiting-room guards remain side-effect free', () => {
    for (const [x, z, dead] of [[3221, 3217, true], [37 * 64 + 30, 48 * 64 + 30, false], [37 * 64 + 10, 148 * 64 + 10, false]]) {
        const player = fixture(x, z);
        if (dead) player.levels[3] = 0;
        player.setVar(doors, 31); player.setVar(lever, 17);
        add(player, 'karamja_rum'); add(player, 'plaguesample'); add(player, 'viking_pointless_magnet'); add(player, 'mm_monkey_in_backpack');
        jump(player);
        assert.deepEqual([player.x, player.z], [x, z]);
        assert.deepEqual(player.events, []);
        assert.equal(player.getVar(doors), 31); assert.equal(player.getVar(lever), 17);
        for (const name of ['karamja_rum', 'plaguesample', 'viking_pointless_magnet', 'mm_monkey_in_backpack']) assert.equal(total(player, name), 1);
    }
});
for (const player of fixtures) { World.players[player.slot] = null; player.cleanup(); }
console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} shared teleport: ${failures.length} failed cases${failures.length ? ` (${failures.join('; ')})` : ''}`);
process.exit(failures.length ? 1 : 0);
