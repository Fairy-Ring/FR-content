import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { World, types, id, player, execute, ScriptProvider, ServerTriggerType, engineModule, worn, inv, map, contentRoot } from '../swamp-caves/runtime.mjs';
import { proveFootpath } from './footpath.mjs';
import { openCentralRoom, advanceSupportTicks as advance } from './support-route.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
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
proveFootpath(2545, 10148);
const remoteRoute = map.findPathToEntity(0, p.x, p.z, supports[1].x, supports[1].z, 1, 1, 1);
const remoteEnd = remoteRoute.at(-1);
assert(remoteEnd === undefined || !map.reachedEntity(0, (remoteEnd >>> 14) & 0x3fff, remoteEnd & 0x3fff, supports[1].x, supports[1].z, 1, 1, 1), 'closed barriers prevent outside melee approach to the opposite prop');
p.teleport(2544, 10143, 0);
equip('rune_scimitar');
execute('[proc,npc_poison_start]', p, [1], { target: supports[1] });
assert(supports[1].vars[id('VarNpcType', 'npc_poison')] > 0);
JavaRandom.setSeed(1);
dispatch(supports[1]);
assert(queues()[1].some(q => q.lastInt > 0), 'a real interior melee attack schedules positive damage');
advance(10);
assert.equal(barrier(supports[1]).type, id('LocType', 'trollrescue_blankmodel_8968'));
assert.equal(supports[1].vars[id('VarNpcType', 'npc_poison')], 0, 'normal destruction clears native poison state');
assert.equal(supports[1].timerInterval, poll, 'normal destruction restores the pressure-controller timer');
proveFootpath(2544, 10143);
advance(reset);
restored();
console.log('PASS interior melee works, clears poison and preserves the pressure timer; packed barriers prevent outside melee reach');

// Native Ranged damage and native queue2 -> custom queue3. No direct HP write,
// test-only damage script or fake death trigger is used to open a barrier.
equip('rune_thrownaxe', 100);
p.teleport(2545, 10147, 0);
proveFootpath(2545, 10147);
execute('[if_button,combat_thrown:thrown2]', p);
assert(map.isLineOfSight(0, p.x, p.z, supports[0].x, supports[0].z), 'the actual north approach has native projectile sight to the opposite south support');
JavaRandom.setSeed(1);
dispatch(supports[0]);
assert(p.invTotal(worn, id('ObjType', 'rune_thrownaxe')) < 100, 'ordinary Ranged consumes actual ammunition');
assert(queues()[0].some(q => q.lastInt > 0), 'real ranged attack schedules positive damage');
advance(10);
assert.equal(supports[0].type, id('NpcType', 'dagannoth_weak_door_fallen_south'));
assert.equal(barrier(supports[0]).type, id('LocType', 'trollrescue_blankmodel_8968'));
for (const n of [supports[1], supports[2]]) assert.equal(barrier(n).type, id('LocType', 'dagcave_invisibleblocking'), 'one death opens only its own barrier');
assert.equal(types.NpcType.get(supports[0].type).op?.some(Boolean) ?? false, false, 'fallen prop is not attackable');
advance(reset);
restored();
console.log('PASS real ranged damage opens only the matching barrier and native lifetimes reset it');

// A native magic attack from the south approach destroys the north prop.
p.teleport(2545, 10139, 0);
proveFootpath(2545, 10139);
assert(map.isLineOfSight(0, p.x, p.z, supports[2].x, supports[2].z), 'the actual south approach has native projectile sight to the opposite north support');
set('action_delay', 0);
JavaRandom.setSeed(1);
const manualBloodBefore = p.invTotal(inv, id('ObjType', 'bloodrune'));
execute('[apnpct,magic:fire_wave]', p, [], { target: supports[2] });
assert(p.invTotal(inv, id('ObjType', 'bloodrune')) < manualBloodBefore, 'the manual attack consumes actual Fire Wave runes');
assert(queues()[2].some(q => q.lastInt > 0), 'real manual magic schedules positive damage');
advance(10);
assert.equal(barrier(supports[2]).type, id('LocType', 'trollrescue_blankmodel_8968'));
advance(reset);
restored();
console.log('PASS real manual Magic damage from the opposite approach and own-side cast refusal');

// This separate fixture starts outside the first door. The traversal suite
// reuses the same helper after its player has used the actual western entrance.
p.teleport(2489, 10162, 0);
proveFootpath(2489, 10162);
openCentralRoom(p);
advance(reset);
restored();
console.log('PASS the ordinary three-player route preserves every native support and barrier reset');

// World owns workers, but this transport-free suite starts no server.
process.exit(0);
