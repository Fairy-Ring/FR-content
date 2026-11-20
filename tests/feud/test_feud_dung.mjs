import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, test } from 'node:test';

import {
  CollisionType, Packet, World, contentRoot, count, engineModule, id, inv, invCom, map, obj, slotOf, types
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import { activeLoc, actors, bit, finish, locs, operateLoc, stage, talk, tickThrough } from './fixture.mjs';

const { LocShape, locShapeLayer } = await engineModule('engine/routefinder/index.ts');
const { default: Jagfile } = await engineModule('io/Jagfile.ts');
const { default: FileStream } = await engineModule('io/FileStream.ts');
const { default: OpLocUDecoder } = await engineModule('network/game/client/codec/OpLocUDecoder.ts');
const { default: OpLocUHandler } = await engineModule('network/game/client/handler/OpLocUHandler.ts');
const { default: JavaRandom } = await engineModule('util/JavaRandom.ts');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine');
const pack = path.join(engine, 'data/pack');
const constants = readFileSync(path.join(contentRoot, 'scripts/quests/quest_feud/configs/feud_poison.constant'), 'utf8');
const constant = name => {
  const value = Number(new RegExp(`^\\^${name}\\s*=\\s*(\\d+)$`, 'm').exec(constants)?.[1]);
  assert(Number.isInteger(value) && value > 0, `named positive ${name}`);
  return value;
};
const radius = constant('feud_camel_trough_range') + 1;
const lifetime = constant('feud_dung_lifetime');
const troughPlacement = locs('feud_foodtrough')[0];
const trough = () => activeLoc(troughPlacement);
const centreLayer = locShapeLayer(LocShape.CENTREPIECE_STRAIGHT);
const names = ['feud_ugthanki_pooh', 'feud_ugthanki_pooh_poisoned'];
const dungTypes = new Set(names.map(name => id('LocType', name)));
// UNKNOWN FEUD-DUNG-PLACEMENT-01, independently stated expected order.
const offsets = [[0, 0], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
const key = loc => `${loc.level}:${loc.x}:${loc.z}:${loc.shape}:${loc.type}`;

function scene() {
  const rows = [];
  for (let x = (troughPlacement.x - radius) & ~7; x <= troughPlacement.x + radius; x += 8) {
    for (let z = (troughPlacement.z - radius) & ~7; z <= troughPlacement.z + radius; z += 8) {
      rows.push(...(World.gameMap.getZoneIfExists(x, z, troughPlacement.level)?.getAllLocsSafe() ?? []));
    }
  }
  return rows;
}
const piles = () => scene().filter(loc => dungTypes.has(loc.type));
const permanentScene = () => scene().filter(loc => !dungTypes.has(loc.type)).map(key).sort();
const centreAt = (x, z, level) => scene().filter(loc => loc.level === level && loc.x === x && loc.z === z && loc.layer === centreLayer);

function collision() {
  const result = [];
  const sizes = [...new Set([1, ...actors('feud_camel').map(camel => camel.width)])];
  for (let x = troughPlacement.x - radius; x <= troughPlacement.x + radius; x++) {
    for (let z = troughPlacement.z - radius; z <= troughPlacement.z + radius; z++) {
      result.push(map.isMapBlocked(x, z, troughPlacement.level));
      for (const [dx, dz] of offsets.slice(1)) {
        for (const size of sizes) result.push(map.canTravel(troughPlacement.level, x, z, dx, dz, size, 0, CollisionType.NORMAL));
        result.push(map.isLineOfSight(troughPlacement.level, x, z, x + dx, z + dz));
      }
    }
  }
  return result;
}

function feeder() {
  const p = player();
  p.setVarBit(bit('feud_var'), 18); // Disclosed compiled-fixture prerequisite, never the headed account.
  p.setVarBit(bit('feud_found_trait'), 1);
  p.setVarBit(bit('feud_hag_list'), 2);
  p.invAdd(inv, obj('superhot_kebab_sauce'), 1);
  p.invAdd(inv, obj('bucket_empty'), 1);
  p.invAdd(inv, obj('coins'), 7);
  return p;
}

function calm(action) {
  const original = Math.random;
  Math.random = () => 0.5; // A stationary ordinary input; do not pick a fresh NPC wander destination.
  for (const camel of actors('feud_camel')) camel.clearWaypoints();
  try { return action(); } finally { Math.random = original; }
}

function feed(p, roll = 0.08) {
  const previous = new Set(piles().map(key));
  const eating = [], restored = [];
  for (const camel of actors('feud_camel')) {
    const original = camel.playAnimation;
    restored.push(() => { camel.playAnimation = original; });
    camel.playAnimation = function (seq, delay) {
      if (seq === id('SeqType', 'camel_eat_from_trough')) eating.push({ x: this.x, z: this.z, level: this.level });
      return original.call(this, seq, delay);
    };
  }
  const random = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => roll;
  const originalTrough = trough();
  const stand = [originalTrough.level,
    originalTrough.x + (originalTrough.angle % 2 ? originalTrough.length : originalTrough.width), originalTrough.z];
  try {
    const messageStart = p.messages.length;
    const response = operateLoc(p, troughPlacement, { item: 'superhot_kebab_sauce', position: stand });
    assert.equal(eating.length, 1, 'one original camel reacts at the actual spawn-time coordinate');
    assert.equal(count(p, 'superhot_kebab_sauce'), 1, 'every ordinary attempt retains the reusable sauce');
    assert.equal(count(p, 'coins'), 7, 'the trough charges nothing');
    assert.equal(trough(), originalTrough, 'the original trough object is not replaced');
    assert.equal(originalTrough.type, troughPlacement.type);
    return { added: piles().filter(loc => !previous.has(key(loc))), camel: eating[0], access: { level: stand[0], x: stand[1], z: stand[2] }, text: `${response.text} ${p.messages.slice(messageStart).join(' ')}` };
  } finally {
    JavaRandom.nextDouble = random;
    for (const restore of restored) restore();
  }
}

function collect(p, loc) {
  assert.equal(loc.shape, LocShape.CENTREPIECE_STRAIGHT);
  p.clearInteraction();
  let admitted = false;
  for (let x = loc.x - 1; x <= loc.x + 1 && !admitted; x++) {
    for (let z = loc.z - 1; z <= loc.z + 1 && !admitted; z++) {
      [p.level, p.x, p.z] = [loc.level, x, z];
      admitted = !map.isMapBlocked(x, z, loc.level) && p.inOperableDistance(loc);
    }
  }
  assert(admitted, 'an ordinary collision-passable bucket-use stand exists');
  p.originX = p.x; p.originZ = p.z;
  const messageStart = p.messages.length;
  const slot = slotOf(p, 'bucket_empty');
  assert(slot >= 0);
  // The actual native-client OPLOCU field order, through the production decoder and handler.
  const packet = new Packet(new Uint8Array(12));
  packet.p2_alt1(loc.type); packet.p2_alt1(invCom); packet.p2_alt1(obj('bucket_empty'));
  packet.p2_alt1(loc.z); packet.p2(slot); packet.p2_alt3(loc.x);
  assert.equal(packet.pos, 12); packet.pos = 0;
  const message = new OpLocUDecoder().decode(packet);
  assert.equal(packet.pos, 12);
  assert(new OpLocUHandler().handle(message, p), 'the real decoded OPLOCU is admitted');
  p.processInteraction();
  finish(p);
  const text = p.messages.slice(messageStart).join(' ');
  assert.match(text, /You scoop up some camel dung into the bucket/);
  assert.equal(count(p, 'bucket_empty'), 0);
  assert.equal(count(p, 'feud_camel_pooh_bucket'), 1);
  assert(!piles().includes(loc), 'the production Bucket-on-Dung handler removes that world pile');
}

function clientType(name) {
  const archive = Jagfile.load(path.join(pack, 'client/config'));
  const dat = archive.read('loc.dat'), idx = archive.read('loc.idx');
  assert(dat && idx, 'the actual built client loc records exist');
  const total = dat.g2(); assert.equal(idx.g2(), total);
  const wanted = id('LocType', name); assert(wanted < total);
  let offset = 2;
  for (let i = 0; i < wanted; i++) offset += idx.g2();
  const length = idx.g2(); dat.pos = offset;
  const type = new types.LocType(wanted); type.decodeType(dat); type.postDecode();
  assert.equal(dat.pos, offset + length, 'the native decoder consumes the indexed client record');
  return type;
}

function assertModel(loc) {
  const type = clientType(types.LocType.get(loc.type).debugname);
  // Cache shape selection, not a substitute renderer. The headed walk also observes getTempModel().
  const models = type.shapes === null
    ? loc.shape === LocShape.CENTREPIECE_STRAIGHT ? [...(type.models ?? [])] : []
    : [...(type.models ?? [])].filter((_, index) => type.shapes[index] === loc.shape);
  assert(models.length > 0, `spawned ${type.debugname ?? type.name} shape ${loc.shape} has a model in the actual built client loc type`);
  const cache = new FileStream(pack, false, true);
  try {
    for (const model of models) {
      const compressed = cache.read(1, model);
      assert(compressed && compressed.length > 2, 'the selected model is in the built client disk cache');
      assert(gunzipSync(compressed.subarray(0, -2)).length > 18, 'the actual model payload is nonempty');
    }
  } finally { cache.close(); }
  assert.equal(type.blockwalk, false, 'the unchanged cache dung is walked over');
  assert.equal(type.blockrange, true, 'the unchanged omitted range default is retained');
}

afterEach(() => {
  const remaining = Math.max(0, ...piles().map(loc => loc.lifecycleTick));
  tickThrough(World.currentTick + remaining);
  assert.equal(piles().length, 0, 'all real fixture piles leave through their native world lifecycle');
});

test('spawned dung has a model for its shape in the built client cache', () => calm(() => {
  const p = feeder(), original = permanentScene(), before = collision();
  for (const roll of [0.079, 0.08]) {
    const result = feed(p, roll);
    assert.equal(result.added.length, 1, 'the real sauce-on-trough handler creates one pile');
    const loc = result.added[0]; assertModel(loc);
    assert.notDeepEqual([loc.x, loc.z], [troughPlacement.x, troughPlacement.z]);
    assert(map.isLineOfWalk(loc.level, result.access.x, result.access.z, loc.x, loc.z));
    assert.deepEqual(collision(), before, 'neither player, camel nor range collision changes');
    assert.deepEqual(permanentScene(), original, 'no original map loc is changed');
  }
  const brown = piles().find(loc => loc.type === id('LocType', names[0]));
  collect(p, brown);
  assert.deepEqual(collision(), before, 'Bucket-on-Dung preserves exact movement and range queries');
  assert.deepEqual(permanentScene(), original);
}));

test('another player can collect a world pile and its creator can finish by repeating for free', () => calm(() => {
  const first = feeder(), second = player(); second.invAdd(inv, obj('bucket_empty'), 1);
  const result = feed(first); assert.equal(result.added.length, 1);
  const shared = result.added[0];
  assert.equal(World.getLoc(shared.x, shared.z, shared.level, shared.type), shared, 'the pile has no per-player owner');
  collect(second, shared);
  assert.equal(stage(first), 18, 'another player taking the pile does not fake the creator\'s quest progress');
  const repeated = feed(first); assert.equal(repeated.added.length, 1);
  collect(first, repeated.added[0]);
  talk(first, 'feud_hag');
  assert.equal(stage(first), 22, 'the creator can still complete the real ingredient handover');
  assert.equal(count(first, 'poison_from_hag'), 1);
  assert.equal(count(first, 'coins'), 7);
}));

test('a world pile survives its creator logout and expires without changing the original tile', () => calm(() => {
  const p = feeder(), observer = player(), original = permanentScene(), before = collision();
  const result = feed(p); assert.equal(result.added.length, 1);
  const loc = result.added[0];
  assert(loc.lifecycleTick > 0 && loc.lifecycleTick <= lifetime);
  World.removePlayer(p); World.logoutRequests.delete(p.username);
  assert.equal(World.getLoc(loc.x, loc.z, loc.level, loc.type), loc, 'logout does not own a world loc');
  const deadline = World.currentTick + loc.lifecycleTick;
  tickThrough(deadline - 1);
  assert(piles().includes(loc), 'the pile remains until its actual final lifecycle tick');
  tickThrough(deadline);
  assert(!piles().includes(loc), 'the native zone lifecycle removes the pile at the deadline');
  assert.equal(stage(observer), 0, 'an unrelated observer gains no quest state');
  assert.deepEqual(collision(), before);
  assert.deepEqual(permanentScene(), original, 'expiry restores the exact original scenery inventory');
}));

test('fixed placement order never replaces an earlier pile and congestion is visible and freely repeatable', () => calm(() => {
  const p = feeder(), collector = player(); collector.invAdd(inv, obj('bucket_empty'), 1);
  const original = permanentScene(), before = collision();
  const first = feed(p); assert.equal(first.added.length, 1);
  const expected = offsets.map(([dx, dz]) => ({ x: first.camel.x + dx, z: first.camel.z + dz, level: first.camel.level }))
    .filter(to => !(to.x === troughPlacement.x && to.z === troughPlacement.z)
      && !map.isMapBlocked(to.x, to.z, to.level)
      && !centreAt(to.x, to.z, to.level).some(loc => !dungTypes.has(loc.type))
      && map.isLineOfWalk(to.level, first.access.x, first.access.z, to.x, to.z));
  assert(expected.length > 0 && expected.length <= offsets.length);
  const created = [first.added[0]];
  assert.deepEqual({ x: created[0].x, z: created[0].z, level: created[0].level }, expected[0]);
  for (let index = 1; index < expected.length; index++) {
    const result = feed(p); assert.equal(result.added.length, 1);
    assert.deepEqual(result.camel, first.camel, 'the ordinary stationary camel input is unchanged');
    const loc = result.added[0];
    assert.deepEqual({ x: loc.x, z: loc.z, level: loc.level }, expected[index], 'the fixed first-free order is used');
    created.push(loc);
    assert(created.every(loc => piles().includes(loc)), 'earlier players\' piles are never replaced');
  }
  const congested = feed(p);
  assert.equal(congested.added.length, 0, 'all nine candidates unavailable produces no hidden replacement');
  assert.match(congested.text, /Nothing interesting happens\./, 'the existing published default is visible');
  assert.equal(piles().length, created.length);
  assert.deepEqual(collision(), before, 'even a crowded pile field cannot trap the player or either camel');
  collect(collector, created[0]);
  const retried = feed(p); assert.equal(retried.added.length, 1);
  assert.deepEqual({ x: retried.added[0].x, z: retried.added[0].z, level: retried.added[0].level }, expected[0]);
  assert.deepEqual(permanentScene(), original);
  assert.equal(count(p, 'superhot_kebab_sauce'), 1);
  assert.equal(count(p, 'coins'), 7);
}));
