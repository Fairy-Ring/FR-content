#!/usr/bin/env node
// Transport-free proof through production movement, login, engine queues and timers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const load = relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
const World = (await load('engine/World.ts')).default;
const Player = (await load('engine/entity/Player.ts')).default;
const { PlayerLoading } = await load('engine/entity/PlayerLoading.ts');
const Packet = (await load('io/Packet.ts')).default;
const ScriptProvider = (await load('engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('engine/script/ScriptState.ts')).default;
const { PlayerTimerType } = await load('engine/entity/EntityTimer.ts');
const JavaRandom = (await load('util/JavaRandom.ts')).default;
const { PlayerStat } = await load('engine/entity/PlayerStat.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  types[name] = (await load(`cache/config/${name}.ts`)).default;
  types[name].load(path.join(engine, 'data/pack'));
}
(await load('cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(path.join(engine, 'data/pack')) > 0, 'build the sibling engine first');
World.gameMap.init();
World.currentTick = 100;
const id = (kind, name) => {
  const result = types[kind].getId(name);
  assert(result >= 0, `packed ${kind} ${name}`);
  return result;
};
const constants = fs.readFileSync(path.join(content, 'scripts/quests/quest_druidspirit/configs/quest_druidspirit.constant'), 'utf8');
const constant = name => {
  const match = new RegExp(`^\\^${name} = (\\d+)$`, 'm').exec(constants);
  assert(match, `named constant ${name}`);
  return Number(match[1]);
};
const interval = constant('swamp_decay_interval');
const minDamage = constant('swamp_decay_damage_min');
const maxDamage = constant('swamp_decay_damage_max');
const stateVar = id('VarPlayerType', 'mortmyre');
const timerScript = ScriptProvider.getByName('[timer,swamp_decay]');
assert(timerScript, 'packed decay timer');
const timer = p => p.timers.get(timerScript.id);
const decayLine = 'The swamp decays you!';
const endLine = 'The swamp decay effect is now over.';
let serial = 0;
function wire(p) {
  p.slot = ++serial;
  p.pid = p.slot;
  p.uid = ((p.slot << 11) | p.slot) >>> 0;
  p.isActive = true;
  p.messages = [];
  p.packets = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  World.players[p.slot] = p;
  World.playerLoop.add(BigInt(p.slot), p);
  return p;
}
function player(x = 3440, z = 3456) {
  const p = wire(new Player(`decay${serial + 1}`, BigInt(serial + 1), BigInt(serial + 1)));
  p.x = x; p.z = z; p.level = 0;
  p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(13034431);
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  p.setVar(id('VarPlayerType', 'druidspirit'), constant('druidspirit_started'));
  p.teleport(x, z, 0);
  tick(p);
  p.messages.length = 0;
  return p;
}
function tick(p, count = 1) {
  for (let n = 0; n < count; n++) {
    p.resetEntity(false);
    World.currentTick++;
    if (p.delayed && World.currentTick >= p.delayedUntil) p.delayed = false;
    if (!p.delayed && p.activeScript?.execution === ScriptState.SUSPENDED) p.executeScript(p.activeScript, true, true);
    p.processQueues();
    if (!p.loggingOut) {
      p.processTimers(PlayerTimerType.NORMAL);
      p.processTimers(PlayerTimerType.SOFT);
    }
    p.processEngineQueue();
    p.processInteraction();
  }
}
function enter(p, x, z) {
  p.teleport(x, z, 0);
  tick(p);
  assert.equal(p.getVar(stateVar), 1, 'entry sets active state');
  assert(timer(p), 'entry starts the compiled timer');
  assert.equal(timer(p).interval, interval, 'timer uses named interval');
  return timer(p);
}
function expiry(p) {
  const remaining = timer(p).clock + interval - World.currentTick;
  assert(remaining >= 0);
  p.spotanimId = -1;
  tick(p, remaining);
}
function noDecay(p, label) {
  const hp = p.levels[PlayerStat.HITPOINTS];
  p.messages.length = 0;
  expiry(p);
  assert.equal(p.levels[PlayerStat.HITPOINTS], hp, `${label}: no damage`);
  assert.deepEqual(p.messages, [], `${label}: silent protection`);
  assert.equal(p.spotanimId, -1, `${label}: no protection graphic`);
  assert(timer(p), `${label}: timer remains active`);
}

// Each authored square is reached through the real teleport notification and engine queue.
for (const [mx, mz] of [[53, 52], [53, 53], [54, 52], [54, 53]]) {
  const p = player();
  const active = enter(p, mx * 64 + 20, mz * 64 + 20);
  const clock = active.clock;
  tick(p, 3);
  p.triggerMapzone(mx * 64, mz * 64);
  tick(p);
  assert.equal(timer(p), active, `${mx},${mz}: duplicate trigger preserves timer identity`);
  assert.equal(timer(p).clock, clock, 'duplicate does not postpone expiry');
  tick(p, interval - (World.currentTick - clock) - 1);
  assert(!p.messages.includes(decayLine), 'no early tick');
  const hp = p.levels[PlayerStat.HITPOINTS];
  tick(p);
  const damage = hp - p.levels[PlayerStat.HITPOINTS];
  assert(damage >= minDamage && damage <= maxDamage, `damage ${damage} in named bounds`);
  assert.equal(p.messages.filter(text => text === decayLine).length, 1);
  assert.equal(timer(p).clock, clock + interval);
}
console.log('PASS four mapzone entries, duplicate suppression, controlled expiry and bounded damage');

// These packed-map components can be reached without entering the swamp.
for (const [label, x, z] of [
  ['Salve west bank', 3392, 3420],
  ['southern west-bank tip', 3392, 3328],
  ['Mortton northern tip', 3440, 3328],
  ['Mortton eastern bank', 3518, 3370],
]) {
  const p = player(3380, 3420);
  p.teleport(x, z, 0); tick(p);
  assert.equal(p.getVar(stateVar), 0, `${label}: map-square entry does not activate decay`);
  assert.equal(timer(p), undefined, `${label}: no timer outside the swamp`);
  tick(p, interval);
  assert(!p.messages.includes(decayLine), `${label}: no decay`);
}
for (const [label, x, z] of [
  ['first gate-side map-square tile', 3443, 3455],
  ['Myreque hideout arrival', 3509, 3449],
  ['Mortton boat arrival', 3498, 3380],
  ['southern western approach', 3428, 3328],
  ['southern eastern approach', 3500, 3328],
  ['eastern swamp edge', 3519, 3375],
]) {
  const p = player();
  enter(p, x, z);
  assert(timer(p), `${label}: included in the shared area definition`);
}
console.log('PASS external banks excluded and gate, route arrivals and all four area rectangles included');

const random = JavaRandom.nextDouble;
try {
  for (const [sample, expected] of [[0, minDamage], [1 - Number.EPSILON, maxDamage]]) {
    const p = player(); enter(p, 3412, 3400);
    const hp = p.levels[PlayerStat.HITPOINTS];
    JavaRandom.nextDouble = () => sample;
    expiry(p);
    assert.equal(hp - p.levels[PlayerStat.HITPOINTS], expected, 'compiled range reaches named endpoint');
  }
} finally { JavaRandom.nextDouble = random; }
for (const inventory of ['inv', 'worn']) {
  const p = player(); enter(p, 3412, 3400);
  p.invAdd(id('InvType', inventory), id('ObjType', 'silver_sickle_blessed'), 1);
  noDecay(p, `${inventory} blessed sickle`);
}
for (const [x, z] of [[3434, 3330], [3448, 3344], [3440, 3338], [3434, 9730], [3448, 9744], [3440, 9738]]) {
  const p = player(); enter(p, 3412, 3400);
  p.teleport(x, z, 0); tick(p);
  noDecay(p, `protected rectangle ${x},${z}`);
}
console.log('PASS carried and worn sickle, both inclusive protected rectangles, silent full intervals');

const p = player(); enter(p, 3412, 3400); expiry(p);
assert(p.messages.includes(decayLine), 'player has already decayed before leaving');
p.messages.length = 0;
p.teleport(3392, 3420, 0); tick(p);
assert(!p.messages.includes(endLine), 'west-bank exit is reported at the next interval, not immediately');
expiry(p);
assert.equal(p.getVar(stateVar), 0);
assert.equal(timer(p), undefined);
assert.equal(p.messages.filter(text => text === endLine).length, 1);
tick(p, interval * 2);
assert.equal(p.messages.filter(text => text === endLine).length, 1, 'end line occurs once');
// Return by an actual map-square entry, as the gate and route arrivals do.
p.teleport(3443, 3456, 0); tick(p);
enter(p, 3412, 3400);
assert.equal(p.getVar(stateVar), 1, 'return starts again');

// Use real walking across an allocated map-square border, without teleporting the tested step.
const walker = player(3443, 3457);
assert.equal(timer(walker), undefined, 'post-gate row 3457 remains outside the inherited extent');
walker.queueWaypoint(3443, 3455);
tick(walker);
assert.equal(walker.z, 3456);
assert.equal(timer(walker), undefined, 'post-gate row 3456 remains outside the inherited extent');
tick(walker);
assert.equal(walker.z, 3455, 'walk crosses onto the first decay-bound tile');
tick(walker); // World drains the queued mapzone trigger before the following movement phase.
assert(timer(walker), 'walking across the map-square border starts decay');

// Save/load and initial-login notification are production methods; transient state is not seeded.
const saved = p.save();
p.cleanup();
assert.equal(p.timers.size, 0, 'logout cleanup drops timers');
const loaded = wire(PlayerLoading.load('decayrelog', new Packet(saved), null));
assert.equal(loaded.getVar(stateVar), 0, 'temporary mortmyre flag is not saved');
assert.equal(loaded.timers.size, 0, 'timers are not serialized');
loaded.onLogin();
tick(loaded, 2);
assert.equal(loaded.getVar(stateVar), 1, 'login inside swamp starts decay');
assert(timer(loaded));
console.log('PASS exit once, re-entry, real walking, teleport and save/load login lifecycle');
process.exit(0);
