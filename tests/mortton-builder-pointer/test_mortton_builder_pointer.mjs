// Regression for the acting-player pointer, not an oracle for period repair rates.
// Run from the sibling engine after its normal build, with NODE_MEMBERS=true.
import assert from 'node:assert/strict';
import {
  World, types, id, player, seed, PlayerStat, ServerTriggerType, engineModule,
} from '../swamp-caves/runtime.mjs';

const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const { PlayerHuntAllCommandIterator } = await engineModule('engine/script/ScriptIterators.ts');
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const ScriptVarType = (await engineModule('cache/config/ScriptVarType.ts')).default;
World.vars = Int32Array.from({ length: types.VarSharedType.count }, (_, i) =>
  types.VarSharedType.get(i).type === ScriptVarType.INT ? 0 : -1);
World.varsString = new Array(types.VarSharedType.count);
const get = (p, name) => p.getVar(id('VarPlayerType', name));
const set = (p, name, value) => p.setVar(id('VarPlayerType', name), value);
const resources = id('VarBitType', 'temple_resources');
const build = id('VarSharedType', 'current_temple_build');
const altar = { x: 3506, z: 3316, level: 0 }; // mortton_temple_altar_coord
const zone = World.gameMap.getZone(altar.x, altar.z, altar.level);
const walls = [...zone.getAllLocsSafe()].filter(loc =>
  types.LocType.get(loc.type).category === id('CategoryType', 'flamtaer_wall'));
const wall = walls.find(loc => loc.x === 3504 && loc.z === 3315);
assert(wall, 'the native west temple wall exists');
const otherWalls = walls.filter(loc => loc !== wall);
assert(otherWalls.length >= 14, 'native temple geometry can hold fourteen other repaired walls');
const brokenAltar = World.getLoc(altar.x, altar.z, altar.level, id('LocType', 'templefire_altar_nofire_broken'));
assert(brokenAltar, 'the native altar begins broken');
const originalLocs = [...walls, brokenAltar].map(loc => [loc, loc.type, loc.shape, loc.angle]);
const builder = seed(player(), ['hammer']);
const bystander = player();
Object.assign(builder, { x: 3505, z: 3315, lastMovement: 0 });
Object.assign(bystander, { x: 3505, z: 3316, lastMovement: 0 });
set(builder, 'morttonquest', 55); // own prerequisite: rebuilding the temple
builder.setVarBit(resources, 1000);
bystander.setVarBit(resources, 321);
set(bystander, 'temple_sanctity', 123);
set(bystander, 'temple_sanctity_p', 4);
// Reverse zone iteration visits the builder first and the bystander last.
zone.enter(bystander);
zone.enter(builder);
const originalRandom = JavaRandom.nextDouble;
JavaRandom.nextDouble = () => 0; // one successful repair vector; no rate claim
const unchanged = () => ({
  vars: [...bystander.vars], experience: [...bystander.stats],
  levels: [...bystander.levels], baseLevels: [...bystander.baseLevels],
  queue: [...bystander.queue.all()], engineQueue: [...bystander.engineQueue.all()],
  timers: [...bystander.timers], target: bystander.target, targetOp: bystander.targetOp,
  animation: bystander.animId,
});
const beforeBystander = unchanged();
const beforeResources = builder.getVarBit(resources);
const beforeExperience = builder.stats[PlayerStat.CRAFTING];
try {
  World.vars[build] = 3900;
  for (const [index, loc] of otherWalls.entries()) {
    const corner = types.LocType.get(loc.type).debugname.startsWith('templewallcorner');
    World.changeLoc(loc, id('LocType', `${corner ? 'templewallcorner' : 'templewall'}_${index < 14 ? '10' : 'base'}`), loc.shape, loc.angle, 9000);
  }
  World.changeLoc(wall, id('LocType', 'templewall_9'), wall.shape, wall.angle, 9000);
  const hunted = [...new PlayerHuntAllCommandIterator(World.currentTick, altar.level, altar.x, altar.z, 3, 0)];
  assert.deepEqual(hunted, [builder, bystander], 'both players are in the altar hunt, bystander last');

  assert(builder.setInteraction(Interaction.ENGINE, wall, ServerTriggerType.APLOC1));
  assert.equal(builder.getOpTrigger().name, '[oploc1,_flamtaer_wall]');
  builder.processInteraction();
  assert.equal(builder.targetOp, ServerTriggerType.APLOC3, 'initial Repair schedules native continuation');
  World.currentTick = get(builder, 'action_delay');
  builder.processInteraction();
  assert.equal(wall.type, id('LocType', 'templewall_10'), 'the builder repairs the final incomplete wall');
  assert.equal(brokenAltar.type, id('LocType', 'templefire_altar_nofire_broken'), 'the altar is still broken before the completing repeat');
  assert.equal(get(builder, 'temple_repaired_p'), 95, 'the first repair saw fourteen complete walls');

  World.currentTick = get(builder, 'action_delay');
  builder.processInteraction();
  assert.equal(brokenAltar.type, id('LocType', 'templefire_altar_nofire'), 'the builder completes the broken altar');
  assert.equal(get(builder, 'temple_repaired_p'), 100, 'all fifteen walls are complete');
  assert.equal(get(builder, 'morttonquest'), 60, 'the builder is allowed to light the altar');
  const spent = beforeResources - builder.getVarBit(resources);
  assert(spent > 0, 'the builder spends repair resources');
  assert.equal(builder.stats[PlayerStat.CRAFTING] - beforeExperience, spent * 5,
    'the builder gains the authored half-XP per resource in tenths');
  assert.equal(World.vars[build], 3900 + spent * 5, 'the repair raises the shared build total');
  assert(get(builder, 'temple_sanctity') > 0, 'sanctity is credited to the builder');
  assert([...builder.queue.all()].some(request => request.script.name === '[queue,update_flamtaer_overlay]'),
    'the builder receives its overlay queue');
  assert.equal(builder.target, wall, 'the builder retains its wall continuation target');
  assert.equal(builder.targetOp, ServerTriggerType.APLOC3, 'the builder gets its next repair');
  assert.equal(builder.animId, id('SeqType', 'human_pickuptable'), 'the builder receives the repair animation');
  assert.deepEqual(unchanged(), beforeBystander, 'bystander variables, experience, queues, timers and animation are unchanged');
  assert.equal(bystander.messages.filter(text => text === 'The holy fire appears sanctified, it can now be lit!').length, 1,
    'the bystander receives the existing sanctification message');
  console.log(`PASS Mortton builder pointer: spent=${spent}, craftingTenths=${spent * 5}; bystander unchanged and notified`);
} finally {
  JavaRandom.nextDouble = originalRandom;
  for (const [loc, type, shape, angle] of originalLocs) World.changeLoc(loc, type, shape, angle, -1);
  for (const p of [builder, bystander]) {
    zone.leave(p);
    p.stopAction();
    World.players[p.slot] = null;
    p.unlink();
    p.cleanup();
  }
}
process.exit(0);
