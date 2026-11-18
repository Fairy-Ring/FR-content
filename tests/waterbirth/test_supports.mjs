import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { World, types, id, player, execute, ScriptProvider, ServerTriggerType, engineModule, worn, inv, map, contentRoot, CollisionType } from '../swamp-caves/runtime.mjs';
import { proveFootpath } from './footpath.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const constants = readFileSync(path.join(contentRoot, 'scripts/areas/area_waterbirth/configs/waterbirth_puzzle.constant'), 'utf8');
const reset = Number(constants.match(/\^waterbirth_support_reset\s*=\s*(\d+)/)?.[1]);
const hp = Number(constants.match(/\^waterbirth_support_hitpoints\s*=\s*(\d+)/)?.[1]);
const poll = Number(constants.match(/\^waterbirth_pressure_poll\s*=\s*(\d+)/)?.[1]);
assert(reset > 1 && hp > 0, 'UNKNOWN engineering values are explicit named constants');
const names = ['south', 'west', 'north'];
const supports = names.map(direction => {
  const type = id('NpcType', `dagannoth_weak_door_${direction}`);
  const n = [...World.npcs].find(n => n.baseType === type);
  assert(n, `natural ${direction} support exists`);
  assert.equal(n.baseLevels[NpcStat.HITPOINTS], hp, 'packed durability matches its labelled constant');
  return n;
});
const barrier = n => World.getLoc(n.x, n.z, n.level, id('LocType', 'dagcave_invisibleblocking')) ?? World.getLoc(n.x, n.z, n.level, id('LocType', 'trollrescue_blankmodel_8968'));
const p = player();
const set = (name, value) => p.setVar(id('VarPlayerType', name), value);
function equip(name, count = 1) {
  const item = types.ObjType.get(id('ObjType', name));
  p.invSet(worn, item.id, count, item.wearpos);
  execute('[proc,player_combat_stat]', p);
  set('action_delay', 0);
  p.clearInteraction();
}
for (const name of ['airrune', 'mindrune', 'firerune', 'bloodrune']) p.invAdd(inv, id('ObjType', name), 1000);
function dispatch(n, trigger = ServerTriggerType.OPNPC2) {
  const script = ScriptProvider.getByTrigger(trigger, n.type, types.NpcType.get(n.type).category);
  assert(script, 'the visible support Destroy operation dispatches into compiled combat');
  return execute(script.name, p, [], { target: n });
}
function advance(ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    World.currentTick++;
    for (const n of supports) n.turn();
    World.processZones();
  }
}
function queues() { return supports.map(n => [...n.queue.all()].filter(q => q.queueId === ServerTriggerType.AI_QUEUE2)); }
function restored() {
  assert(supports.every(n => n.type === n.baseType && n.levels[NpcStat.HITPOINTS] === hp), 'native support lifetime restores all props with full health');
  assert(supports.every(n => barrier(n)?.type === id('LocType', 'dagcave_invisibleblocking')), 'native loc lifetime restores the three physical barriers');
}
equip('rune_thrownaxe', 100);
for (const [index, n] of supports.entries()) {
  const own = index === 0 ? [n.x, n.z - 2] : index === 1 ? [n.x - 2, n.z] : [n.x, n.z + 2];
  p.teleport(...own, 0);
  p.messages.length = 0;
  dispatch(n);
  assert(p.messages.includes('This door does not seem to be openable from this side...'), 'ordinary ranged initial targeting refuses the own-corridor support');
  assert(queues().every(q => q.length === 0), 'refusal schedules no support damage');
  set('action_delay', 0);
  execute('[apnpct,magic:wind_strike]', p, [], { target: n });
  assert(queues().every(q => q.length === 0), 'manual cast carries the same directional gate');
  set('rockthrower', 10);
  set('ownedmcannon', (p.level << 28) | (p.x << 14) | p.z);
  execute('[proc,cannon_fire]', p, [], { target: n });
  assert(queues().every(q => q.length === 0), 'native cannon also carries the initial-side gate');
  assert.equal(p.getVar(id('VarPlayerType', 'rockthrower')), 10, 'refused cannon fire consumes no ball');
}
// CANDIDATE Door-support source explicitly allows any combat style inside the
// ladder room. Outside, the other-path target is beyond native melee reach.
p.teleport(2545, 10148, 0);
const remoteRoute = map.findPathToEntity(0, p.x, p.z, supports[1].x, supports[1].z, 1, 1, 1);
const remoteEnd = remoteRoute.at(-1);
assert(remoteEnd === undefined || !map.reachedEntity(0, (remoteEnd >>> 14) & 0x3fff, remoteEnd & 0x3fff, supports[1].x, supports[1].z, 1, 1, 1), 'closed barriers prevent outside melee approach to the opposite prop');
p.teleport(2545, 10142, 0);
equip('rune_scimitar');
JavaRandom.setSeed(1);
dispatch(supports[0]);
assert(queues()[0].some(q => q.lastInt > 0), 'a real interior melee attack schedules positive damage');
advance(10);
assert.equal(barrier(supports[0]).type, id('LocType', 'trollrescue_blankmodel_8968'));
proveFootpath(2545, 10142);
advance(reset);
restored();
console.log('PASS interior melee works, while packed barriers prevent outside melee reach');

// Native Ranged damage and native queue2 -> custom queue3. No direct HP write,
// test-only damage script or fake death trigger is used to open a barrier.
equip('rune_thrownaxe', 100);
p.teleport(2545, 10148, 0);
proveFootpath(2545, 10148);
proveFootpath(2545, 10149);
// A native poison-start control exercises destruction cleanup. Poison does not
// open the barrier: the following ordinary Ranged hit still has to kill it.
execute('[proc,npc_poison_start]', p, [1], { target: supports[1] });
assert(supports[1].vars[id('VarNpcType', 'npc_poison')] > 0);
JavaRandom.setSeed(1);
dispatch(supports[1]);
assert(queues()[1].some(q => q.lastInt > 0), 'real ranged attack schedules positive damage');
advance(10);
assert.equal(supports[1].type, id('NpcType', 'dagannoth_weak_door_fallen_west'));
assert.equal(barrier(supports[1]).type, id('LocType', 'trollrescue_blankmodel_8968'));
for (const n of [supports[0], supports[2]]) assert.equal(barrier(n).type, id('LocType', 'dagcave_invisibleblocking'), 'one death opens only its own barrier');
assert.equal(types.NpcType.get(supports[1].type).op?.some(Boolean) ?? false, false, 'fallen prop is not attackable');
assert.equal(supports[1].vars[id('VarNpcType', 'npc_poison')], 0, 'normal destruction clears native poison state');
assert.equal(supports[1].timerInterval, poll, 'normal destruction restores the pressure-controller timer');
advance(reset);
restored();
console.log('PASS real ranged damage opens only the matching barrier and native lifetimes reset it');

// A native magic attack from another path can also destroy the same prop.
set('action_delay', 0);
JavaRandom.setSeed(1);
execute('[apnpct,magic:fire_wave]', p, [], { target: supports[1] });
assert(queues()[1].some(q => q.lastInt > 0), 'real manual magic schedules positive damage');
advance(10);
assert.equal(barrier(supports[1]).type, id('LocType', 'trollrescue_blankmodel_8968'));
advance(reset);
restored();
console.log('PASS real manual Magic damage and own-side cast refusal');

// Toggle the actual packed special button, then the ordinary Destroy dispatch.
// The player remains outside the north prop, so its destruction must be a
// native chain hit rather than an initial attack which bypasses the side gate.
equip('rune_thrownaxe', 100);
p.teleport(2545, 10148, 0);
set('sa_energy', 1000);
set('sa_attack', 0);
execute('[if_button,combat_thrown:specbar]', p);
assert.equal(p.getVar(id('VarPlayerType', 'sa_attack')), 1);
JavaRandom.setSeed(1);
dispatch(supports[1]);
const hits = queues();
assert(hits.every(q => q.some(hit => hit.lastInt > 0)), 'unmodified rune thrownaxe special chains real positive hits onto all three mapped supports');
assert(p.getVar(id('VarPlayerType', 'sa_energy')) < 1000, 'native special consumes energy');
assert(p.invTotal(worn, id('ObjType', 'rune_thrownaxe')) < 100, 'native special consumes actual ammunition');
advance(10);
assert(supports.every(n => n.type === id('NpcType', `dagannoth_weak_door_fallen_${names[supports.indexOf(n)]}`)), 'all three supports visibly fall');
assert(supports.every(n => barrier(n)?.type === id('LocType', 'trollrescue_blankmodel_8968')), 'the native chain opens every original barrier');
// The unchanged chain above spans the x=2544 and z=10144 zone boundaries.
// Check both ends of every approved zone without constraining later units'
// decisions about any neighboring zone's period classification.
for (const x of [2536, 2543, 2544, 2551]) for (const z of [10136, 10143, 10144, 10151]) {
  assert(World.gameMap.isMulti(CoordGrid.packCoord(0, x, z)), 'all four approved support-room zones consistently permit multi-combat');
}
for (const [x, z, dx, dz] of [[2543, 10143, 1, 0], [2544, 10143, -1, 0], [2545, 10143, 0, 1], [2545, 10144, 0, -1]]) {
  assert(map.canTravel(0, x, z, dx, dz, 1, 0, CollisionType.NORMAL), 'an opened support fight is physically crossable in both directions at each zone boundary');
}
assert(map.isLineOfWalk(0, 2541, 10143, 2545, 10143), 'the cleared western corridor crosses the x-zone boundary');
assert(map.isLineOfWalk(0, 2545, 10143, 2541, 10143), 'the western boundary cannot trap a player returning from the ladder room');
assert(map.isLineOfWalk(0, 2545, 10148, 2545, 10143), 'the player can physically enter through the cleared north barrier');
proveFootpath(2545, 10143);
for (const support of supports) proveFootpath(support.x, support.z, support.level);
advance(reset);
restored();
console.log('PASS unchanged rune thrownaxe special, three real hits, three barriers, physical entry and reset');

// World owns workers, but this transport-free suite starts no server.
process.exit(0);
