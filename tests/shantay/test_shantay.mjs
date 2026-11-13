// Execute packed production triggers and dialogue through ScriptRunner, without a server.
// From the sibling engine: node --import tsx ../content/tests/shantay/test_shantay.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const Environment = await load('util/Environment.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
    types[name] = await load(`cache/config/${name}.ts`);
    types[name].load(pack);
}
assert.ok(ScriptProvider.load(pack) > 0, 'full compiled pack required');
World.currentTick = 100;
World.gameMap.init();
const invId = types.InvType.getId('inv');
const coins = types.ObjType.getId('coins');
const pass = types.ObjType.getId('shantay_pass');
const jail = types.VarPlayerType.getId('shantay_jail_progress');
const components = new Map(fs.readFileSync(path.join(content, 'pack/interface.pack'), 'utf8').split('\n').filter(x => /^\d+=/.test(x)).map(x => { const at = x.indexOf('='); return [x.slice(at + 1).trim(), Number(x.slice(0, at))]; }));
const purchaseLine = 'I want to buy a shantay pass for 5 gold coins.';
const success = 'You purchase a Shantay Pass.';
const refusal = "Sorry friend, the Shantay Pass is 5 gold coins. You don't seem to have enough money!";
let serial = 0;
function fixture(amount) {
    const p = new Player(`shantay_${++serial}`, BigInt(serial), BigInt(serial));
    p.uid = serial; p.pid = serial; p.slot = serial;
    p.x = 3303; p.z = 3123; p.level = 0; p.lastMovement = 0;
    p.vars.fill(0); p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.packets.push({ text });
    p.wrappedMessageGame = p.messageGame;
    p.getInventory(invId).add(coins, amount);
    return p;
}
const count = (p, id) => p.getInventory(invId).getItemCount(id);
const text = p => p.packets.map(x => x.text ?? '').join(' ').replace(/[|\s]+/g, ' ');
function run(p, entry, choices = []) {
    const script = ScriptProvider.getByName(entry);
    assert.ok(script, `missing packed ${entry}`);
    const type = types.NpcType.getId('shantay');
    const npc = new Npc(0, 3304, 3123, 1, 1, EntityLifeCycle.RESPAWN, 1, type, types.NpcType.get(type).blockwalk);
    const state = ScriptRunner.init(script, p, npc);
    let result = p.runScript(state, true, true);
    for (let n = 0; result === ScriptState.PAUSEBUTTON && n < 100; n++) {
        const menu = state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
        if (menu) {
            assert.ok(choices.length, `unanswered ${state.script.name}`);
            p.lastCom = components.get(`multi${menu[1]}:com_${choices.shift()}`);
            assert.ok(Number.isInteger(p.lastCom));
        }
        result = p.runScript(state, true, true);
    }
    assert.equal(result, ScriptState.FINISHED, `${entry} must finish`);
    assert.equal(choices.length, 0);
}
const originalMembers = Environment.NODE_MEMBERS;
try {
    Environment.NODE_MEMBERS = true;
    for (const amount of [5, 6, 10, 100]) {
        const p = fixture(amount);
        run(p, '[opnpc4,shantay]');
        assert.equal(count(p, pass), 1);
        assert.equal(count(p, coins), amount - 5);
        assert.ok(text(p).includes(success));
        assert.ok(!text(p).includes(purchaseLine), 'direct option omits player line');
        assert.ok(!text(p).includes('Hello effendi'), 'direct option omits greeting');
        assert.equal(p.getVar(jail), 0, 'direct purchase does not run Talk-to greeting writer');
    }
    console.log('PASS packed opnpc4: exact grant, exact price, no Talk-to pages');
    {
        const p = fixture(10);
        run(p, '[opnpc4,shantay]'); run(p, '[opnpc4,shantay]');
        assert.equal(count(p, pass), 2); assert.equal(count(p, coins), 0);
    }
    for (const amount of [0, 4]) {
        const p = fixture(amount);
        run(p, '[opnpc4,shantay]');
        assert.equal(count(p, pass), 0); assert.equal(count(p, coins), amount);
        assert.ok(text(p).includes(refusal));
    }
    console.log('PASS insufficient coins: no mutation and existing refusal');
    Environment.NODE_MEMBERS = false;
    {
        const p = fixture(5);
        run(p, '[opnpc4,shantay]');
        assert.equal(count(p, pass), 0); assert.equal(count(p, coins), 5);
        assert.ok(text(p).includes("Sorry effendi, I can't offer this service right now."));
        assert.ok(!text(p).includes(purchaseLine));
    }
    Environment.NODE_MEMBERS = true;
    for (const amount of [4, 5, 10]) {
        const p = fixture(amount);
        run(p, '[opnpc1,shantay]', [4]);
        assert.equal(count(p, pass), amount < 5 ? 0 : 1);
        assert.equal(count(p, coins), amount < 5 ? amount : amount - 5);
        assert.ok(text(p).includes('Hello effendi, I am Shantay.'));
        assert.ok(text(p).includes(purchaseLine));
        assert.ok(text(p).includes(amount < 5 ? refusal : success));
        assert.equal(p.getVar(jail), 1);
    }
    console.log('PASS free-world refusal and unchanged real Talk-to menu purchase');
    {
        const p = fixture(5);
        p.getInventory(invId).add(types.ObjType.getId('bronze_dagger'), 27);
        const drops = [];
        const addObj = World.addObj;
        World.addObj = function (obj, ...args) {
            drops.push({ type: obj.type, count: obj.count, x: obj.x, z: obj.z });
            return addObj.call(this, obj, ...args);
        };
        try {
            run(p, '[opnpc1,shantay]', [4]);
        } finally {
            World.addObj = addObj;
        }
        assert.equal(count(p, pass), 0, 'inherited grant precedes freeing the coin slot');
        assert.equal(count(p, coins), 0);
        assert.ok(drops.some(obj => obj.type === pass && obj.count === 1 && obj.x === p.x && obj.z === p.z));
        assert.ok(text(p).includes(success));
    }
    console.log('PASS inherited full-inventory dialogue: pass drops at feet, coins charged, success box');
    console.log('RESULT PASS Shantay compiled production triggers');
} finally {
    Environment.NODE_MEMBERS = originalMembers;
}
process.exit(0);
