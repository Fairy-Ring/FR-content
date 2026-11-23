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

// Classify collision components independently of the authored decay predicate.
// Closing every walking step into the inside components models closed swamp
// entrances without excluding the bound itself (which would hide added tiles).
{
  const map = await load('engine/GameMap.ts');
  const { CollisionType } = await load('engine/routefinder/index.ts');
  const inSquares = (x, z) => x >= 53 * 64 && x < 55 * 64 && z >= 52 * 64 && z < 54 * 64;
  const inSurvey = (x, z) => x >= 3200 && x <= 3711 && z >= 3072 && z <= 3647;
  const key = (x, z) => x * 65536 + z;
  const free = (x, z) => map.isZoneAllocated(0, x, z) && !map.isMapBlocked(x, z, 0);
  const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const outsideStarts = [
    ['gate north', 3444, 3462], ['Canifis', 3490, 3480],
    ['temple east', 3410, 3470], ['temple west', 3380, 3485],
    ['Salve west bank', 3385, 3400], ['west bank within the squares', 3393, 3410],
    ['Mortton', 3486, 3288], ['Mortton rowboat', 3522, 3284],
    ['south of the bridge', 3429, 3326], ['Burgh de Rott', 3495, 3250],
    ['east side', 3545, 3450], ['Barrows', 3565, 3289],
  ];
  const insideStarts = [
    ['inside the gate', 3443, 3457], ['first decay tile', 3443, 3455],
    ['Mortton boat arrival', 3498, 3380], ['Myreque arrival', 3509, 3449],
  ];
  for (const [label, x, z] of [...outsideStarts, ...insideStarts]) {
    assert(inSurvey(x, z) && free(x, z), `${label}: flood start is allocated and walkable`);
  }
  for (const x of [3443, 3444]) {
    assert.equal(map.canTravel(0, x, 3457, 0, 1, 1, 0, CollisionType.NORMAL), false, 'packed north gate stays closed');
    assert.equal(map.canTravel(0, x, 3458, 0, -1, 1, 0, CollisionType.NORMAL), false, 'packed south gate stays closed');
  }
  function flood(starts, allowed) {
    const seen = new Set(), tiles = [];
    for (const [label, x, z] of starts) {
      assert(allowed(x, z), `${label}: flood starts on its declared side of the entrances`);
      if (!seen.has(key(x, z))) { seen.add(key(x, z)); tiles.push([x, z]); }
    }
    for (let at = 0; at < tiles.length; at++) {
      const [x, z] = tiles[at];
      for (const [dx, dz] of directions) {
        const nx = x + dx, nz = z + dz, next = key(nx, nz);
        if (!inSurvey(nx, nz) || !allowed(nx, nz) || seen.has(next) || !free(nx, nz) ||
            !map.canTravel(0, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
        seen.add(next); tiles.push([nx, nz]);
      }
    }
    return { seen, tiles };
  }
  // These components depend on the packed map and arrival tiles, never on the
  // area proc. Both adding an outside tile and omitting an inside tile stay visible.
  const core = flood(insideStarts.filter(([, x, z]) => inSquares(x, z)), inSquares);
  const outside = flood(outsideStarts, (x, z) => !core.seen.has(key(x, z)));
  const inside = flood(insideStarts, (x, z) => !outside.seen.has(key(x, z)));
  const areaScript = ScriptProvider.getByName('[proc,in_swamp_decay_area]');
  assert(areaScript, 'packed shared decay predicate');
  const probe = player();
  function executeAt(script, x, z) {
    probe.x = x; probe.z = z;
    const state = ScriptRunner.init(script, probe, null, []);
    assert.equal(probe.runScript(state, true, true), ScriptState.FINISHED, 'compiled boundary probe finishes synchronously');
    return state;
  }
  const inArea = (x, z) => executeAt(areaScript, x, z).popInt() === 1;
  function protectedGrotto(x, z) {
    // Ask the compiled timer, not a copied pair of rectangles. With no sickle,
    // only its grotto branch silently preserves the active flag outside the area.
    probe.setVar(stateVar, 1);
    probe.messages.length = 0;
    probe.spotanimId = -1;
    const hp = probe.levels[PlayerStat.HITPOINTS];
    executeAt(timerScript, x, z);
    return probe.getVar(stateVar) === 1 && probe.messages.length === 0 &&
      probe.levels[PlayerStat.HITPOINTS] === hp && probe.spotanimId === -1;
  }
  assert.equal(probe.invTotal(id('InvType', 'inv'), id('ObjType', 'silver_sickle_blessed')), 0);
  assert.equal(probe.invTotal(id('InvType', 'worn'), id('ObjType', 'silver_sickle_blessed')), 0);
  assert.deepEqual(outside.tiles.filter(([x, z]) => inArea(x, z)), [],
    'no outside-reachable tile is inside the compiled decay bound');
  assert.deepEqual(inside.tiles.filter(([x, z]) => inSquares(x, z) && !inArea(x, z) && !protectedGrotto(x, z)), [],
    'no swamp-reachable tile of the four squares is outside the compiled bound and grotto protection');
  console.log('PASS packed collision floods: outside inclusion and inside omission sets are empty; every start is walkable');
}

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
const walkingEvents = [];
const walkingMessage = walker.messageGame;
walker.messageGame = text => {
  walkingEvents.push({ kind: 'message', text, tick: World.currentTick });
  return walkingMessage(text);
};
const walkingDamage = walker.applyDamage.bind(walker);
walker.applyDamage = (damage, type) => {
  walkingEvents.push({ kind: 'hit', tick: World.currentTick });
  return walkingDamage(damage, type);
};
walker.queueWaypoint(3443, 3455);
tick(walker);
assert.equal(walker.z, 3456);
assert.equal(timer(walker), undefined, 'post-gate row 3456 remains outside the inherited extent');
tick(walker);
assert.equal(walker.z, 3455, 'walk crosses onto the first decay-bound tile');
const crossingTick = World.currentTick;
tick(walker); // World drains the queued mapzone trigger before the following movement phase.
assert(timer(walker), 'walking across the map-square border starts decay');
assert.equal(timer(walker).clock, crossingTick + 1, 'walking queues the mapzone trigger for the next player phase');
tick(walker, interval - 1);
assert.deepEqual(walkingEvents, [], 'no decay before the full interval measured from timer creation');
tick(walker);
assert.deepEqual(walkingEvents.map(event => event.kind), ['message', 'hit'], 'the timer prints before synchronous damage_self');
const [walkingLine, walkingHit] = walkingEvents;
assert.equal(walkingLine.text, decayLine);
assert.equal(walkingLine.tick, crossingTick + interval + 1, 'timer expires exactly at its controlled clock plus interval');
assert.equal(walkingHit.tick, walkingLine.tick, 'damage is immediate in the same server cycle, not queued');
// NetworkPlayer.writeInner sends the message before World.processClientsOut sends
// PLAYER_INFO. cell.mjs counts completed PLAYER_INFO packets: the message sees
// the preceding counter, while the hit in the following packet sees the new one.
const receivedLineTick = walkingLine.tick - 1;
const receivedHitTick = walkingHit.tick;
assert.equal(receivedLineTick - crossingTick, interval, 'received line minus crossing is exactly the named interval');
assert.equal(receivedHitTick - receivedLineTick, 1, 'received hit minus line is exactly one PLAYER_INFO counter boundary');
console.log('PASS exact received-clock projection: decay line at interval, same-cycle hit one counter boundary later');

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
