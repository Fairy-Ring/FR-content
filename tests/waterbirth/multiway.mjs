import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { World, types, id, player, execute, ScriptProvider, ServerTriggerType, map, CollisionType, contentRoot, engineModule, PlayerStat } from '../swamp-caves/runtime.mjs';
import { centralToDeepRows, deepLadderRows, kingsRoomLadderRows, rockyStepsRows } from './traversal-data.mjs';

const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
// Original 377 Dagexp ladder squares plus the separately mapped Kings lair.
// The combat classification is an operator-authorized CANDIDATE inference,
// not a claim that the cache contains historical combat-zone boundaries.
const deeperSquares = new Set(['28_68', '29_68', '30_68', '45_69']);
const firstFloorSquares = new Set(['38_158', '39_158']);
const square = point => `${point.x >> 6}_${point.z >> 6}`;
const key = point => `${point.level}:${point.x}:${point.z}`;
const zoneKey = point => `${point.level}_${point.x >> 6}_${point.z >> 6}_${point.x & 56}_${point.z & 56}`;
const open = point => map.isZoneAllocated(point.level, point.x, point.z) && !map.isMapBlocked(point.x, point.z, point.level);
const multi = point => World.gameMap.isMulti(CoordGrid.packCoord(point.level, point.x, point.z));

function connectedFloor(seeds, squares) {
  const points = new Map();
  const queue = [];
  for (const seed of seeds) {
    assert(open(seed), `original ladder landing ${key(seed)} is native-unblocked`);
    if (points.has(key(seed))) continue;
    points.set(key(seed), seed);
    queue.push(seed);
  }
  for (let at = 0; at < queue.length; at++) {
    const current = queue[at];
    for (const [dx, dz] of directions) {
      const next = { level: current.level, x: current.x + dx, z: current.z + dz };
      if (!open(next) || !map.canTravel(current.level, current.x, current.z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      assert(squares.has(square(next)), `native connected dungeon floor leaves inventoried squares at ${key(next)}`);
      if (points.has(key(next))) continue;
      points.set(key(next), next);
      queue.push(next);
    }
  }
  return [...points.values()];
}

const deeperRows = [...centralToDeepRows, ...deepLadderRows, ...kingsRoomLadderRows];
const deeperPoints = connectedFloor(deeperRows.map(row => row.landing).filter(point => deeperSquares.has(square(point))), deeperSquares);
const deeperZones = new Set(deeperPoints.map(zoneKey));
assert(deeperZones.size > 0, 'the original ladder graph yields player-reachable deeper zones');
const actualDeeperRows = readFileSync(path.join(contentRoot, 'maps/multiway.csv'), 'utf8').split(/\r?\n/)
  .filter(line => /^\d+_\d+_\d+_\d+_\d+$/.test(line))
  .filter(line => { const [, mx, mz] = line.split('_'); return deeperSquares.has(`${mx}_${mz}`); });
assert.equal(new Set(actualDeeperRows).size, actualDeeperRows.length, 'deeper multiway rows are not duplicated');
assert.deepEqual([...actualDeeperRows].sort(), [...deeperZones].sort(), 'every reachable deeper zone, and no zone outside that original floor footprint, is configured multi');
for (const point of deeperPoints) assert.equal(multi(point), true, `deeper floor ${key(point)} is native multi-combat`);
const firstPoints = connectedFloor([rockyStepsRows[0].landing, centralToDeepRows[1].landing], firstFloorSquares);
for (const point of firstPoints) assert.equal(multi(point), false, `first-floor tile ${key(point)} remains single-combat`);
console.log(`PASS Waterbirth zone footprint: ${deeperZones.size} deeper zones, ${deeperPoints.length} reachable deeper tiles, ${firstPoints.length} single-combat first-floor tiles`);

const vp = name => id('VarPlayerType', name);
const vn = name => id('VarNpcType', name);
const attackAnimParam = id('ParamType', 'attack_anim');
const magicAttackAnimParam = id('ParamType', 'magicattack_anim');
const originalRandom = JavaRandom.nextDouble;
// Fixed test RNG only; combat policy and packed skill data are unchanged.
JavaRandom.nextDouble = () => 0.5;

function fixturePatch(points, size) {
  const available = new Set(points.map(key));
  for (const point of points) {
    let valid = true;
    for (let dx = 0; dx <= size * 2 && valid; dx++) for (let dz = -1; dz < size; dz++) {
      if (!available.has(key({ level: point.level, x: point.x + dx, z: point.z + dz }))) { valid = false; break; }
    }
    if (valid) return point;
  }
  assert.fail(`no real connected-floor combat patch fits size ${size}`);
}

function addNpc(type, point) {
  const npc = new Npc(point.level, point.x, point.z, type.size, type.size, EntityLifeCycle.RESPAWN, World.getNextNid(), type.id, type.blockwalk);
  World.addNpc(npc, -1);
  World.processNpcEventQueue();
  npc.lastMovement = -100;
  assert.strictEqual(World.npcs.get(npc.nid), npc, 'fixture uses the native world NPC registry');
  return npc;
}
function cleanupPlayer(actor) {
  World.gameMap.getZone(actor.x, actor.z, actor.level).leave(actor);
  World.players[actor.slot] = null;
  actor.unlink();
}
function cleanupNpc(npc) {
  if (npc.isActive) World.removeNpc(npc, -1);
  if (World.npcs.get(npc.nid) === npc) { World.npcs.remove(npc.nid); npc.cleanup(); }
}
function playerAttack(actor, npc) {
  const dispatch = ScriptProvider.getByTrigger(ServerTriggerType.OPNPC2, npc.type, types.NpcType.get(npc.type).category);
  assert(dispatch, 'native player Attack dispatch is present');
  execute(dispatch.name, actor, [], { target: npc });
}

function proveCombat(name, points, expectedMulti) {
  const type = types.NpcType.get(id('NpcType', name));
  const attackAnimation = type.params.get(type.params.has(magicAttackAnimParam) ? magicAttackAnimParam : attackAnimParam);
  assert(Number.isInteger(attackAnimation), `${name}: owned native attack animation parameter is present`);
  const patch = fixturePatch(points, type.size);
  const primary = player(), helper = player();
  const npcs = [];
  const attacks = [[], []];
  const restorers = [];
  World.currentTick += 100;
  try {
    primary.teleport(patch.x + type.size, patch.z, patch.level);
    helper.teleport(patch.x + type.size - 1, patch.z - 1, patch.level);
    for (const actor of [primary, helper]) {
      actor.setVar(vp('option_nodef'), 1);
      // Low defence is a fixture, not a selected period player statistic.
      actor.baseLevels[PlayerStat.DEFENCE] = actor.levels[PlayerStat.DEFENCE] = 1;
      actor.baseLevels[PlayerStat.MAGIC] = actor.levels[PlayerStat.MAGIC] = 1;
      execute('[proc,player_combat_stat]', actor);
    }
    for (const [index, dx] of [0, type.size + 1].entries()) {
      const npc = addNpc(type, { ...patch, x: patch.x + dx });
      npcs.push(npc);
      const original = npc.playAnimation;
      npc.playAnimation = function (anim, delay) {
        if (anim === attackAnimation) attacks[index].push(World.currentTick);
        return original.call(this, anim, delay);
      };
      restorers.push(() => { delete npc.playAnimation; });
      npc.setVar(vn('npc_aggressive_player'), primary.uid);
      npc.enqueueScript(ServerTriggerType.AI_QUEUE1);
      assert.equal(multi(npc), expectedMulti, `${name}: both native NPC coordinates have the intended combat mode`);
    }
    // Queue retaliation normally, then let each native NPC turn choose and run
    // its real melee/ranged/magic action. No combat predicate is called alone.
    for (let tick = 0; tick < 20 && attacks[0].length === 0; tick++) {
      for (const npc of npcs) npc.turn();
      if (attacks[0].length === 0) World.currentTick++;
    }
    assert.equal(attacks[0].length, 1, `${name}: first monster attacks the primary player`);
    assert.equal(attacks[1].length, expectedMulti ? 1 : 0, `${name}: second monster is permitted only below the single-combat first floor`);
    if (expectedMulti) assert.equal(attacks[1][0], attacks[0][0], `${name}: both monsters attack in the same native tick`);
    const queuedPlayerDamage = [...primary.queue.all()].filter(entry => entry.script?.name === '[queue,combat_damage_player]');
    assert.equal(queuedPlayerDamage.length, expectedMulti ? 2 : 1, `${name}: permitted attacks queue real player damage`);
    playerAttack(primary, npcs[0]);
    assert.equal(npcs[0].getVar(vn('npc_aggressive_player')), primary.uid, `${name}: primary's real attack establishes the fight`);
    assert(primary.getVar(vp('action_delay')) > World.currentTick, `${name}: primary attack actually executes`);
    const before = [...npcs[0].queue.all()].filter(entry => entry.queueId === ServerTriggerType.AI_QUEUE2).length;
    playerAttack(helper, npcs[0]);
    const after = [...npcs[0].queue.all()].filter(entry => entry.queueId === ServerTriggerType.AI_QUEUE2).length;
    assert.equal(after - before, expectedMulti ? 1 : 0, `${name}: second player queues a real attack only in multi-combat`);
    assert.equal(helper.getVar(vp('action_delay')) > World.currentTick, expectedMulti, `${name}: second-player attack delay proves execution/refusal`);
    assert.equal(helper.messages.includes('Someone else is fighting that.'), !expectedMulti, `${name}: first-floor teammate receives the native refusal`);
    for (let tick = 0; tick < 20 && primary.queue.all().some(entry => entry.script?.name === '[queue,combat_damage_player]'); tick++) {
      primary.processQueues();
      World.currentTick++;
    }
    assert(!primary.queue.all().some(entry => entry.script?.name === '[queue,combat_damage_player]'), `${name}: native damage queues resolve`);
    assert(primary.levels[PlayerStat.HITPOINTS] < 99, `${name}: the real attack phases damage the primary fixture`);
    console.log(`PASS ${name}: multi=${expectedMulti}, native NPC attacks=${attacks.map(entries => entries.length).join('+')}, second-player queued damage=${after - before}`);
  } finally {
    restorers.forEach(restore => restore());
    npcs.forEach(cleanupNpc);
    cleanupPlayer(primary); cleanupPlayer(helper);
  }
}
try {
  for (const family of ['mainroom', 'lighter', 'magic_monster']) {
    proveCombat(`dungeon_dagganoth_${family}`, firstPoints, false);
    proveCombat(`dungeon_dagganoth_${family}_deeper`, deeperPoints, true);
  }
} finally {
  JavaRandom.nextDouble = originalRandom;
}
console.log('PASS Waterbirth compiled multiway combat: all three attack families on each side of the first-floor boundary');
process.exit(0);
