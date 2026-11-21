#!/usr/bin/env node
/** Packed Set-up through the real inventory handler, on native empty collision fixtures.
 * The fixtures isolate area permission from walls/void. The headed cell separately
 * uses the unmodified published map at a real entrance. No script/opcode is mocked.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async file => import(pathToFileURL(path.join(engine, 'src', file)).href);
const World = (await load('engine/World.ts')).default;
const Player = (await load('engine/entity/Player.ts')).default;
const ScriptProvider = (await load('engine/script/ScriptProvider.ts')).default;
const ScriptState = (await load('engine/script/ScriptState.ts')).default;
const OpHeld = (await load('network/game/client/model/OpHeld.ts')).default;
const handler = new (await load('network/game/client/handler/OpHeldHandler.ts')).default();
const routeFinder = (await load('engine/routefinder/index.ts')).default;
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  types[name] = (await load(`cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'load current production scripts');
const id = (kind, name) => {
  const result = types[kind].getId(name);
  assert(result >= 0, `${kind}:${name}`);
  return result;
};
const constant = name => {
  const match = new RegExp(`^\\^${name}\\s*=\\s*(\\d+)\\s*$`, 'm').exec(readFileSync(path.join(content, 'scripts/general/configs/quest.constant'), 'utf8'));
  assert(match, name); return Number(match[1]);
};
const areas = JSON.parse(readFileSync(new URL('./areas.json', import.meta.url)));
const inv = id('InvType', 'inv'), com = id('Component', 'inventory:inv');
const parts = ['twpart1', 'twpart2', 'twpart3', 'twpart4'].map(name => id('ObjType', name));
const base = id('LocType', 'multicannon_base');
const variable = name => id('VarPlayerType', name);
const inside = ([level, x, z], box) => level >= box[0] && level <= box[3] && x >= box[1] && x <= box[4] && z >= box[2] && z <= box[5];
const denied = tile => areas.some(area => area.boxes.some(box => inside(tile, box)));
let serial = 0, refused = 0, allowed = 0;
World.currentTick = 100;
function fixture(tile) {
  const slot = ++serial;
  const p = new Player(`carea${slot}`, BigInt(slot), BigInt(slot));
  p.slot = slot; p.pid = slot; p.uid = (slot << 11) | slot; p.isActive = true;
  [p.level, p.x, p.z] = tile; p.originX = p.x; p.originZ = p.z;
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(13034431);
  p.setVar(variable('tutorial'), 1000); p.setVar(variable('mcannon'), constant('mcannon_complete'));
  p.setVar(variable('ownedmcannon'), -1);
  p.messages = []; p.write = () => {};
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  World.players[slot] = p; World.playerLoop.add(p.hash64, p);
  p.tabs[3] = types.Component.get(com).rootLayer;
  p.invListenOnCom(inv, com, p.uid);
  for (const part of parts) p.invAdd(inv, part, 1);
  p.invAdd(inv, id('ObjType', 'coins'), 100);
  p.invAdd(inv, id('ObjType', 'mcannonball'), 30);
  // Native collision allocation, not altered opcode answers: empty fixture zones
  // let all geometric outside-boundary cases exercise the complete Set-up path.
  for (let dx = -8; dx <= 8; dx += 8) for (let dz = -8; dz <= 8; dz += 8) {
    routeFinder.allocateIfAbsent(p.x + dx, p.z + dz, p.level);
    World.gameMap.getZone(p.x + dx, p.z + dz, p.level);
  }
  return p;
}
function attempt(label, tile, expected) {
  const p = fixture(tile);
  const before = structuredClone(Array.from({ length: types.InvType.get(inv).size }, (_, slot) => p.invGetSlot(inv, slot)));
  assert(handler.handle(new OpHeld(1, parts[0], 0, com), p), `${label}: native item packet accepted`);
  for (let tick = 0; p.activeScript && tick < 12; tick++) {
    assert.equal(p.activeScript.execution, ScriptState.SUSPENDED, `${label}: only normal setup delays`);
    World.currentTick++;
    if (World.currentTick >= p.delayedUntil) p.delayed = false;
    p.updateMovement();
    if (!p.delayed) p.executeScript(p.activeScript, true, true);
    p.resetEntity(false);
  }
  assert.equal(p.activeScript, null, `${label}: setup finishes within twelve ticks`);
  const origin = { x: tile[1] - 1, z: tile[2] - 1, level: tile[0] };
  const placed = [...World.gameMap.getZone(origin.x, origin.z, origin.level).getAllLocsSafe()].find(loc => loc.x === origin.x && loc.z === origin.z && loc.type === base);
  if (expected) {
    assert.deepEqual(p.messages, ["You can't set up a cannon here."], `${label}: exact published refusal`);
    assert.deepEqual(Array.from({ length: types.InvType.get(inv).size }, (_, slot) => p.invGetSlot(inv, slot)), before, `${label}: entire inventory unchanged`);
    assert.equal(p.getVar(variable('ownedmcannon')), -1, `${label}: ownership unchanged`);
    assert.equal(p.getVar(variable('dropcannon')), 0, `${label}: assembly stage unchanged`);
    assert.equal(p.getVar(variable('rockthrower')), 0, `${label}: ammunition unchanged`);
    assert(!placed, `${label}: no cannon base created`); refused++;
  } else {
    assert(p.messages.includes('You place the cannon base on the ground.'), `${label}: outside really places the base: ${p.messages}`);
    assert(placed, `${label}: real loc exists`);
    assert.equal(p.invTotal(inv, parts[0]), 0, `${label}: base consumed only on success`);
    for (const part of parts.slice(1)) assert.equal(p.invTotal(inv, part), 1, `${label}: other parts retained`);
    World.removeLoc(placed, -1); allowed++;
  }
  p.unlink(); World.players[p.slot] = null;
}
for (const area of areas) for (const { name, tile, refused } of area.cases ?? []) attempt(`${area.name}: ${name}`, tile, refused);
for (const area of areas) for (const [index, box] of area.boxes.entries()) {
  const [low, west, south, high, east, north] = box;
  const midX = (west + east) >> 1, midZ = (south + north) >> 1;
  for (let level = low; level <= high; level++) {
    const label = `${area.name} box ${index} floor ${level}`;
    for (const [edge, x, z] of [['interior', midX, midZ], ['west', west, midZ], ['east', east, midZ], ['south', midX, south], ['north', midX, north], ['southwest', west, south], ['southeast', east, south], ['northwest', west, north], ['northeast', east, north]]) attempt(`${label} ${edge}`, [level, x, z], true);
    for (const [edge, x, z] of [['west', west - 1, midZ], ['east', east + 1, midZ], ['south', midX, south - 1], ['north', midX, north + 1]]) {
      const tile = [level, x, z];
      // Shared internal box edges are still inside the union, not outside it.
      attempt(`${label} immediately outside ${edge}`, tile, denied(tile));
    }
  }
  for (const level of [low - 1, high + 1].filter(level => level >= 0 && level < 4)) {
    const tile = [level, midX, midZ]; attempt(`${area.name} adjacent floor ${level}`, tile, denied(tile));
  }
}
attempt('existing bank refusal', [0, 3253, 3420], true);
attempt('ordinary Wilderness is not blanket-banned', [0, 3100, 3700], false);
// N010 is settled by placement only while every checked-out native-map
// Kurask/Turoth spawn remains inside the refused Fremennik dungeon.
const fremennik = areas.find(area => area.name === 'Fremennik Slayer Dungeon');
assert(fremennik, 'explicit Fremennik area oracle');
const species = new Map();
for (let npc = 0; npc < types.NpcType.count; npc++) {
  const name = types.NpcType.get(npc).name;
  if (name === 'Kurask' || name === 'Turoth') species.set(npc, name);
}
const spawns = [];
for (const file of readdirSync(path.join(content, 'maps'))) {
  const square = /^m(\d+)_(\d+)\.jm2$/.exec(file);
  if (!square) continue;
  const npcSection = readFileSync(path.join(content, 'maps', file), 'utf8').split('==== NPC ====')[1]?.split('====')[0] ?? '';
  for (const line of npcSection.split('\n')) {
    const spawn = /^([0-3]) (\d+) (\d+): (\d+)/.exec(line);
    if (!spawn || !species.has(Number(spawn[4]))) continue;
    const tile = [Number(spawn[1]), Number(square[1]) * 64 + Number(spawn[2]), Number(square[2]) * 64 + Number(spawn[3])];
    const name = species.get(Number(spawn[4]));
    assert(fremennik.boxes.some(box => inside(tile, box)), `${name} outside Fremennik at ${tile}: N010 no longer settled`);
    attempt(`${name} native spawn ${tile}`, tile, true);
    spawns.push({ name, tile });
  }
}
for (const name of ['Kurask', 'Turoth']) assert(spawns.some(spawn => spawn.name === name), `non-vacuous ${name} coverage`);
console.log('N010 native spawns:', JSON.stringify(spawns));
console.log(`PASS cannon areas: ${refused} refused, ${allowed} full native setups outside; all floors, edges, inventory and ownership`);
process.exit(0);
