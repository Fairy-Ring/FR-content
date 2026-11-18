import assert from 'node:assert/strict';
import { World, types, id, player, execute, ScriptProvider, ServerTriggerType, engineModule, worn, inv, map, CollisionType } from '../swamp-caves/runtime.mjs';
import { proveFootpath } from './footpath.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const supports = ['south', 'west', 'north'].map(direction => {
  const support = [...World.npcs].find(n => n.baseType === id('NpcType', `dagannoth_weak_door_${direction}`));
  assert(support, `natural ${direction} support exists`);
  return support;
});
const barrier = n => World.getLoc(n.x, n.z, n.level, id('LocType', 'dagcave_invisibleblocking')) ?? World.getLoc(n.x, n.z, n.level, id('LocType', 'trollrescue_blankmodel_8968'));
const damageQueued = n => [...n.queue.all()].some(q => q.queueId === ServerTriggerType.AI_QUEUE2 && q.lastInt > 0);

export function advanceSupportTicks(ticks = 1) {
  for (let tick = 0; tick < ticks; tick++) {
    World.currentTick++;
    for (const support of supports) support.turn();
    World.processZones();
  }
}

function walkPlayer(actor, x, z) {
  if (actor.x === x && actor.z === z) return;
  const route = map.findPath(0, actor.x, actor.z, x, z);
  const last = route.at(-1);
  assert(last !== undefined && ((last >>> 14) & 0x3fff) === x && (last & 0x3fff) === z, 'the cooperative route has an exact native walking path');
  for (const packed of route) {
    const tx = (packed >>> 14) & 0x3fff, tz = packed & 0x3fff;
    while (actor.x !== tx || actor.z !== tz) {
      const dx = Math.sign(tx - actor.x), dz = Math.sign(tz - actor.z);
      assert(map.canTravel(0, actor.x, actor.z, dx, dz, 1, 0, CollisionType.NORMAL), 'the cooperative player never steps through closed packed collision');
      actor.teleport(actor.x + dx, actor.z + dz, 0);
      advanceSupportTicks();
    }
  }
}

function equip(actor, name, count = 1) {
  const item = types.ObjType.get(id('ObjType', name));
  actor.invSet(worn, item.id, count, item.wearpos);
  execute('[proc,player_combat_stat]', actor);
  actor.clearInteraction();
}

function destroy(actor, support) {
  const script = ScriptProvider.getByTrigger(ServerTriggerType.OPNPC2, support.type, types.NpcType.get(support.type).category);
  assert(script, 'the visible support Destroy operation dispatches into compiled combat');
  JavaRandom.setSeed(1);
  execute(script.name, actor, [], { target: support });
  // Native ordinary autocast first schedules P_OPNPCT; the next player
  // interaction tick, not a directly selected spell handler, performs the cast.
  if (actor.targetOp === ServerTriggerType.APNPCT) {
    assert.equal(actor.target, support, 'ordinary autocast retains its native support target');
    const position = [actor.level, actor.x, actor.z];
    advanceSupportTicks();
    actor.processInteraction();
    assert.deepEqual([actor.level, actor.x, actor.z], position, 'the native cast succeeds from the outside approach without walking into the barrier');
  }
  assert(damageQueued(support), 'the ordinary native attack schedules real positive damage');
}

// The caller supplies its actual first-room player: this helper never seeds or
// replaces the route player's position, a support's HP, or a barrier's state.
// Only the two helpers' outside starting positions and own combat gear/runes
// are fixture seeds. Every later move follows individually checked native steps.
export function openCentralRoom(main) {
  assert.equal(main.level, 0);
  const magician = player(), padHelper = player();
  for (const name of ['airrune', 'firerune', 'bloodrune']) magician.invAdd(inv, id('ObjType', name), 1000);
  equip(magician, 'staff_of_air');
  execute('[if_button,combat_staff_2:auto_choose]', magician);
  execute('[if_button,staff_spells:ssb15]', magician);
  execute('[if_button,combat_staff_2:auto_toggle]', magician);
  equip(main, 'rune_thrownaxe', 100);
  execute('[if_button,combat_thrown:thrown2]', main);
  for (const [actor, x, z] of [[magician, 2489, 10130], [padHelper, 2489, 10164]]) {
    proveFootpath(x, z);
    actor.teleport(x, z, 0);
  }
  const pressure = (z, name) => World.getLoc(2491, z, 0, id('LocType', name));
  walkPlayer(main, 2490, 10162);
  assert(pressure(10162, 'dagannoth_pressure_door'), 'one occupied north stone does not open the door');
  walkPlayer(padHelper, 2490, 10164);
  assert(pressure(10162, 'dagannoth_pressure_open'), 'two real players open the north door');
  walkPlayer(main, 2493, 10163);
  walkPlayer(padHelper, 2489, 10164);
  walkPlayer(main, 2545, 10147);
  assert(pressure(10162, 'dagannoth_pressure_door'), 'the vacated north door resets behind the first attacker');
  walkPlayer(padHelper, 2490, 10132);
  walkPlayer(magician, 2490, 10130);
  assert(pressure(10130, 'dagannoth_pressure_open'), 'the remaining two real players open the south door');
  walkPlayer(magician, 2493, 10131);
  walkPlayer(padHelper, 2489, 10132);
  walkPlayer(magician, 2545, 10139);
  assert(pressure(10130, 'dagannoth_pressure_door3'), 'the vacated south door resets behind the second attacker');
  assert(map.isLineOfSight(0, main.x, main.z, supports[0].x, supports[0].z), 'the north approach has native projectile sight to SOUTH');
  assert(map.isLineOfSight(0, magician.x, magician.z, supports[2].x, supports[2].z), 'the south approach has native projectile sight to NORTH');
  destroy(main, supports[0]);
  assert(main.invTotal(worn, id('ObjType', 'rune_thrownaxe')) < 100, 'ordinary Ranged consumes actual ammunition');
  const bloodBefore = magician.invTotal(inv, id('ObjType', 'bloodrune'));
  destroy(magician, supports[2]);
  assert(magician.invTotal(inv, id('ObjType', 'bloodrune')) < bloodBefore, 'ordinary Destroy uses native Magic autocast, not a remotely dispatched staff melee hit');
  advanceSupportTicks(10);
  assert.equal(barrier(supports[0]).type, id('LocType', 'trollrescue_blankmodel_8968'));
  assert.equal(barrier(supports[2]).type, id('LocType', 'trollrescue_blankmodel_8968'));
  walkPlayer(main, 2545, 10143);
  walkPlayer(magician, 2545, 10142);
  walkPlayer(main, 2544, 10143);
  equip(main, 'rune_scimitar');
  destroy(main, supports[1]);
  advanceSupportTicks(10);
  assert(supports.every(n => barrier(n)?.type === id('LocType', 'trollrescue_blankmodel_8968')), 'three ordinary attacks open all matching barriers without a special or multi-combat addition');
  for (const [x, z] of [[2545, 10147], [2545, 10139], [2545, 10143], [2545, 10142], [2544, 10143]]) proveFootpath(x, z);
  for (const support of supports) proveFootpath(support.x, support.z, support.level);
  console.log('PASS three real players cross both first doors; ordinary Ranged and Magic open each other’s barriers and interior Melee opens WEST');
  return { main, magician, padHelper, supports };
}
