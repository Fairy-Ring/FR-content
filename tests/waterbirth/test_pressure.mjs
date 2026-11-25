import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { World, types, id, player, execute, ScriptProvider, ServerTriggerType, map, CollisionType, contentRoot } from '../swamp-caves/runtime.mjs';
import { proveFootpath } from './footpath.mjs';

const source = readFileSync(path.join(contentRoot, 'maps/m38_158.jm2'), 'utf8');
const graceSource = readFileSync(path.join(contentRoot, 'scripts/areas/area_waterbirth/configs/waterbirth_puzzle.constant'), 'utf8');
const poll = Number(graceSource.match(/\^waterbirth_pressure_poll\s*=\s*(\d+)/)?.[1]);
const grace = Number(graceSource.match(/\^waterbirth_pressure_grace\s*=\s*(\d+)/)?.[1]);
assert(grace > 1, 'the explicitly labelled grace is a positive multi-tick duration');
const controller = [...World.npcs].find(n => n.baseType === id('NpcType', 'dagannoth_weak_door_west'));
assert(controller, 'natural mapped support runs the controller');
assert.equal(controller.timerInterval, poll, 'packed native timer uses the explicit occupancy-polling constant');
const main = player(), helper = player();
const place = (p, x, z) => p.teleport(x, z, 0);
function advance(ticks = 1) {
  for (let tick = 0; tick < ticks; tick++) {
    World.currentTick++;
    controller.turn();
    World.processZones();
  }
}
const rows = [
  ['dagannoth_pressure_door3', 18],
  ['dagannoth_pressure_door2', 34],
  ['dagannoth_pressure_door', 50],
];
for (const [name, localZ] of rows) {
  const z = 158 * 64 + localZ, x = 38 * 64 + 59;
  assert(source.includes(`0 59 ${localZ}: ${id('LocType', name)} 10 1`), 'door is the original mapped loc');
  for (const [pad, dz] of [['dagannoth_pressure_pad_2', 0], ['dagannoth_pressure_pad_1', 2]]) {
    assert(source.includes(`0 58 ${localZ + dz}: ${id('LocType', pad)} 22`), 'each distinct stone is placed in the cache map');
  }
  const closed = id('LocType', name), open = id('LocType', 'dagannoth_pressure_open');
  const current = () => World.getLoc(x, z, 0, closed) ?? World.getLoc(x, z, 0, open);
  const crossing = () => map.canTravel(0, x - 1, z + 1, 1, 0, 1, 0, CollisionType.NORMAL);
  for (const [px, pz] of [[x - 1, z], [x - 2, z], [x - 1, z + 2], [x - 2, z + 1], [x - 2, z + 2]]) proveFootpath(px, pz);
  place(main, x - 1, z); place(helper, x - 2, z);
  advance();
  assert.equal(current()?.type, closed, `${name}: one player does not open the door`);
  assert.equal(crossing(), false, 'native packed collision blocks entry');
  place(helper, x - 1, z);
  advance();
  assert.equal(current()?.type, closed, 'two players on one stone do not count as two occupied stones');
  place(helper, x - 1, z + 2);
  advance();
  assert.equal(current()?.type, open, 'both distinct stones open the actual cache door');
  assert.equal(crossing(), true, 'opening removes native collision');
  proveFootpath(x + 1, z + 1);
  proveFootpath(x + 2, z + 1);
  advance(grace * 2);
  assert.equal(current()?.type, open, 'continued occupancy refreshes the native reset, without closing on players');
  const remaining = current().lifecycleTick;
  assert.equal(remaining, grace - 1, 'the native zone phase consumes one tick after the last occupancy refresh');
  place(main, x + 1, z + 1);
  const departureTick = World.currentTick;
  advance(remaining - 1);
  assert.equal(current()?.type, open, 'the door remains open until the final remaining native tick');
  advance();
  assert.equal(current()?.type, closed, 'native lifecycle restores the closed form on its final remaining tick');
  assert.equal(World.currentTick - departureTick, remaining, 'observed post-departure open lifetime uses the native phase boundary');
  assert.equal(crossing(), false, 'reset restores collision');
  const dispatch = ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1, closed, types.LocType.get(closed).category);
  assert(dispatch?.name.includes(name), 'the visible closed form has an exact player handler');
  execute(dispatch.name, main, [], { target: current() });
  assert.equal(current()?.type, open, 'a lone player inside opens the exit without help');
  assert.equal(crossing(), true, 'the lone player has a physical exit, not a teleport');
  place(main, x - 2, z + 1); place(helper, x - 2, z + 2);
  advance(grace);
  execute(dispatch.name, main, [], { target: current() });
  assert.equal(current()?.type, closed, 'outside Open is not a solo bypass');
  assert.equal(types.LocType.get(open).op?.some(Boolean) ?? false, false, 'no player-controlled Close can trap someone');
  console.log(`PASS ${name}: real two-player occupancy, collision and lone exit; configured native duration=${grace}, observed close after departure ticks=${remaining}`);
}

const stock = types.InvType.get(id('InvType', 'ranging_guild_tribalshop'));
const axe = id('ObjType', 'rune_thrownaxe');
const slot = [...stock.stockobj].indexOf(axe);
assert(slot >= 0 && stock.stockcount[slot] > 0 && stock.restock, 'the required thrownaxe is obtainable from the existing restocking shop');
const salesman = types.NpcType.get(id('NpcType', 'ranging_guild_tribal_salesman'));
assert.equal(salesman.params.get(id('ParamType', 'owned_shop')), stock.id, 'mapped merchant owns that stock');
assert([...World.npcs].some(n => n.baseType === salesman.id), 'the merchant exists in the actual map');
assert(ScriptProvider.getByTrigger(ServerTriggerType.OPNPC1, salesman.id, salesman.category), 'the stock is connected to a compiled merchant operation');
console.log('PASS required rune thrownaxe is available through the existing compiled shop');

// World owns workers, but this transport-free suite starts no server.
process.exit(0);
