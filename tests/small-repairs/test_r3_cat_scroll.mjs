// Run the packed completion queue and observe the shared helper's packet order.
// From the sibling engine: node --import tsx ../content/tests/small-repairs/test_r3_cat_scroll.mjs
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
const Environment = await load('util/Environment.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
    types[name] = await load(`cache/config/${name}.ts`);
    types[name].load(pack);
}
assert.ok(ScriptProvider.load(pack) > 0, 'full compiled pack required');
const components = new Map(fs.readFileSync(path.join(content, 'pack/interface.pack'), 'utf8').split('\n').filter(line => /^\d+=/.test(line)).map(line => {
    const at = line.indexOf('=');
    return [line.slice(at + 1).trim(), Number(line.slice(0, at))];
}));
const component = name => {
    assert.ok(components.has(name), `missing packed component ${name}`);
    return components.get(name);
};
World.currentTick = 100;
World.gameMap.init();
const player = new Player('r3_cat_scroll', 1n, 1n);
player.uid = 1; player.pid = 1; player.slot = 1;
player.vars.fill(0);
player.packets = [];
player.messages = [];
player.write = packet => player.packets.push(packet);
const opens = [];
player.openMainModal = function (component) {
    opens.push({ component, afterPackets: this.packets.length });
    return Player.prototype.openMainModal.call(this, component);
};
player.messageGame = text => player.messages.push(text);
player.wrappedMessageGame = player.messageGame;
const cookingBefore = player.stats[PlayerStat.COOKING];
const script = ScriptProvider.getByName('[queue,fluffs_complete]');
assert.ok(script, 'packed completion queue required');
const state = ScriptRunner.init(script, player);
assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, 'real completion queue finishes');
assert.equal(player.stats[PlayerStat.COOKING], cookingBefore + 15250 * Environment.NODE_XPRATE, '1,525 Cooking XP unchanged');

const root = component('questscroll_death');
const rows = [
    [3, "You have completed Gertrude's Cat."],
    [9, '1 Quest Point'],
    [10, '1,525 Cooking XP'],
    [11, 'A Kitten'],
    [12, 'A Chocolate Cake'],
    [13, 'Some Stew'],
    [14, '']
];
const rowIds = new Set(rows.map(([row]) => component(`questscroll_death:com_${row}`)));
const textPackets = player.packets.filter(packet => packet.constructor.name === 'IfSetText' && rowIds.has(packet.component));
assert.deepEqual(textPackets.map(packet => [packet.component, packet.text]), rows.map(([row, text]) => [component(`questscroll_death:com_${row}`), text]), 'shared helper sets the same title and reward rows in order');
const kitten = types.ObjType.getId('kittenobject');
assert.equal(kitten, 1555, '377 selectable reward kitten object id');
assert.equal(types.ObjType.get(kitten).model, 3009, '377 reward kitten head model');
const model = player.packets.filter(packet => packet.constructor.name === 'IfSetObject');
assert.equal(model.length, 1, 'completion must send the cat object instead of an item-less scroll');
assert.deepEqual([model[0].component, model[0].obj, model[0].scale], [component('questscroll_death:com_4'), kitten, 90], 'reward kitten head must fit the picture slot instead of overlapping the scroll roll');
assert.equal(opens.length, 1, 'one completion scroll request');
assert.equal(opens[0].component, root, 'existing generic scroll root unchanged');
assert.equal(player.modalMain, root, 'production modal state carries the unchanged root');
assert.ok(player.packets.indexOf(textPackets.at(-1)) < player.packets.indexOf(model[0]), 'all reward rows precede the model setter');
assert.ok(player.packets.indexOf(model[0]) < opens[0].afterPackets, 'model setter precedes the production scroll-open request');
assert.deepEqual(player.messages, ['Congratulations! Quest complete!'], 'completion message unchanged');
console.log('RESULT PASS packed Gertrude completion: title, seven rows, reward kitten object 1555 scale 90, then existing scroll root');
process.exit(0);
