import assert from 'node:assert/strict';
import {
  World, ScriptProvider, ScriptState, ServerTriggerType as Trigger, PlayerStat,
  engineModule, types, id, inv, worn, obj, seed, count, inventory, tile,
  player as makePlayer, execute, environmentTick, map, button
} from '../swamp-caves/runtime.mjs';

const { getExpByLevel } = await engineModule('engine/entity/Player.ts');
function player() {
  const p = makePlayer();
  p.stats.fill(getExpByLevel(99));
  return p;
}
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const Runner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Pointer = (await engineModule('engine/script/ScriptPointer.ts')).default;
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const { CollisionFlag: F } = await engineModule('engine/routefinder/flags.ts');
const routeFinder = (await engineModule('engine/routefinder/index.ts')).default;
const v = name => id('VarPlayerType', name);
const nv = name => id('VarNpcType', name);
const read = (p, name) => p.getVar(v(name));
const write = (p, name, value) => p.setVar(v(name), value);
const proc = (p, name, args = [], target = null) => execute(`[proc,${name}]`, p, args, { target });
const packed = (x, z, level = 0) => CoordGrid.packCoord(level, x, z);
const npcs = name => [...World.npcs].filter(n => types.NpcType.get(n.type).debugname === name && n.isActive);
const knightFor = p => npcs('pest_voidknight_control1').find(n => World.instances.findInstanceByCoord(n)?.uid === read(p, 'pest_instance') - 1);
function runNpc(npc, name, args = [], p = null, lastInt = 0) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled ${name}`);
  const state = Runner.init(script, npc, p, args);
  state.lastInt = lastInt;
  if (p) state.pointerAdd(Pointer.ProtectedActivePlayer);
  npc.executeScript(state);
  for (let boundary = 0; state.execution === ScriptState.NPC_SUSPENDED && boundary < 40; boundary++) {
    World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
    npc.delayed = false;
    npc.executeScript(state);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes`);
  return state;
}
function move(p, x, z, level = 0) {
  p.teleport(x, z, level);
  p.delayed = false;
  p.clearInteraction();
}
function locNamed(name, x, z, level = 0) {
  const zone = World.gameMap.getZone(x, z, level);
  const result = [...zone.getAllLocsSafe()].find(l => types.LocType.get(l.type).debugname === name);
  assert(result, `packed map has ${name} near ${x},${z},${level}`);
  return result;
}
function locOp(p, loc, option = 1) {
  const type = types.LocType.get(loc.type);
  const script = ScriptProvider.getByTrigger(Trigger[`OPLOC${option}`], loc.type, type.category);
  assert(script, `${type.debugname} visible-form dispatch has option ${option}`);
  return execute(script.name, p, [], { target: loc });
}
function npcOp(p, npc, option = 1) {
  const type = types.NpcType.get(npc.type);
  const script = ScriptProvider.getByTrigger(Trigger[`OPNPC${option}`], npc.type, type.category);
  assert(script, `${type.debugname} visible-form dispatch has option ${option}`);
  return execute(script.name, p, [], { target: npc });
}
function damageNpc(p, npc, amount) {
  const type = types.NpcType.get(npc.type);
  const handler = ScriptProvider.getByTrigger(Trigger.AI_QUEUE2, npc.type, type.category);
  assert(handler, `${type.debugname}: native damage dispatch exists`);
  npc.setVar(nv('npc_aggressive_player'), p.uid);
  npc.setVar(nv('npc_attacking_uid'), p.uid);
  return runNpc(npc, handler.name, [], p, amount);
}
function deathNpc(npc) {
  const type = types.NpcType.get(npc.type);
  const handler = ScriptProvider.getByTrigger(Trigger.AI_QUEUE3, npc.type, type.category);
  assert(handler, `${type.debugname}: native death dispatch exists`);
  return runNpc(npc, handler.name);
}
function equip(p, name, amount = 1) {
  const type = types.ObjType.get(obj(name));
  p.getInventory(worn).set(type.wearpos, { id: type.id, count: amount });
}
function npcTimer(npc) {
  const type = types.NpcType.get(npc.type);
  const handler = ScriptProvider.getByTrigger(Trigger.AI_TIMER, npc.type, type.category);
  assert(handler, `${type.debugname}: native timer dispatch exists`);
  return runNpc(npc, handler.name);
}
function nativeHit(p, npc, style, credit = true) {
  World.currentTick = Math.max(World.currentTick, read(p, 'action_delay'));
  move(p, npc.x - 1, npc.z + 1);
  const queued = new Set(npc.queue.all()), activity = read(p, 'pest_activity');
  const hp = npc.levels[PlayerStat.HITPOINTS], random = JavaRandom.nextDouble;
  const draws = [0.999, 0, 0.5];
  JavaRandom.nextDouble = () => draws.shift() ?? 0.5;
  try {
    execute(style === 'magic' ? '[apnpct,magic:wind_strike]' : `[label,player_${style}_attack]`, p, [], { target: npc });
  } finally { JavaRandom.nextDouble = random; p.clearInteraction(); }
  const hits = [...npc.queue.all()].filter(request => !queued.has(request) && request.queueId === Trigger.AI_QUEUE2);
  assert.equal(hits.length, 1, `${style}: real player path queues one NPC hit`);
  assert(hits[0].lastInt > 0, `${style}: deterministic hit fixture deals damage`);
  assert.equal(read(p, 'pest_activity'), credit ? Math.min(50, activity + Math.min(hp, hits[0].lastInt)) : activity, `${style}: activity changes only for the actual participant attacking an owned Pest target`);
  const damage = hits[0].lastInt;
  hits[0].unlink();
  const credited = read(p, 'pest_activity');
  damageNpc(p, npc, damage);
  assert.equal(npc.levels[PlayerStat.HITPOINTS], Math.max(0, hp - damage), `${style}: native NPC damage still applies`);
  assert.equal(read(p, 'pest_activity'), credited, `${style}: NPC queue cannot credit the loot hero again`);
}
function incomingHit(p, npc, prayer, protectedHit) {
  World.currentTick = Math.max(World.currentTick + 10, npc.getVar(nv('npc_action_delay')));
  move(p, npc.x - 1, npc.z + 1);
  for (const name of ['prayer12', 'prayer13', 'prayer14']) write(p, name, name === prayer ? 1 : 0);
  const before = new Set(p.queue.all()), hp = p.levels[PlayerStat.HITPOINTS];
  npcTimer(npc); npc.turn();
  const attacks = [...p.queue.all()].filter(request => !before.has(request) && request.script.name === '[queue,pest_player_attack]');
  assert.equal(attacks.length, 1, 'native NPC timer dispatches one attack at the real participant');
  attacks[0].unlink();
  execute(attacks[0].script.name, p, attacks[0].args);
  const hits = [...p.queue.all()].filter(request => !before.has(request) && request.script.name === '[queue,combat_damage_player]');
  assert(hits.length <= 1, 'one native Pest attack cannot queue duplicate player hits');
  const damage = hits.reduce((sum, hit) => sum + hit.args[0], 0);
  if (protectedHit) assert.equal(damage, 0, `${prayer}: matching protection prevents damage`);
  else assert(damage > 0, `${prayer}: protection against the other style cannot stop this attack`);
  for (const hit of hits) { hit.unlink(); execute(hit.script.name, p, hit.args); }
  assert.equal(p.levels[PlayerStat.HITPOINTS], hp - damage, 'native queued player damage really resolves');
  for (const request of p.queue.all()) if (!before.has(request)) request.unlink();
  for (const name of ['prayer12', 'prayer13', 'prayer14']) write(p, name, 0);
  p.clearInteraction();
}
function drain(...players) {
  for (let i = 0; i < 4; i++) environmentTick(...players);
}
function walkable(x, z, level, targetX, targetZ, label) {
  const flag = routeFinder.collisionFlags.get(x, z, level);
  assert.equal(flag & (F.FLOOR | F.LOC), 0, `${label}: real landing is walkable`);
  const route = [...map.findPath(level, x, z, targetX, targetZ)];
  assert(route.length > 0, `${label}: nonempty real findPath route out`);
  const end = route.at(-1);
  assert.equal(end, packed(targetX, targetZ, level), `${label}: route reaches independent area anchor`);
}
function board(p) {
  move(p, 2657, 2639);
  const plank = locNamed('pest_lander_gangplank', 2658, 2639);
  locOp(p, plank);
  assert.equal(read(p, 'pest_instance'), -1, 'real plank enters waiting state');
  assert.deepEqual(tile(p), [0, 2660, 2640], 'waiting lander landing');
}
function depart(...players) {
  const squire = npcs('pest_squire_lander')[0];
  assert(squire, 'real packed waiting lander Squire');
  // Controlled clock only: no match progress, points, monsters or portals seeded.
  World.currentTick = squire.getVar(nv('pest_depart_clock'));
  runNpc(squire, '[ai_timer,pest_squire_lander]');
  drain(...players);
  for (const p of players) {
    assert(read(p, 'pest_instance') > 0, `real boat departure assigns an instance: ${JSON.stringify(players.map(member => [member.pid, read(member, 'pest_instance'), read(member, 'pest_activity')]))}`);
    assert(knightFor(p), 'product spawns the match Void Knight');
  }
  return knightFor(players[0]);
}
function cleanup(p) {
  if (read(p, 'pest_instance') !== 0) proc(p, 'pest_leave');
  World.gameMap.getZone(p.x, p.z, p.level).leave(p);
  p.unlink();
  World.players[p.pid] = null;
  p.isActive = false;
}

// Original slots, original client bytes and server-only participation state.
assert.equal(v('pest_points'), 238);
assert.equal(v('pest_activity'), 239);
assert.equal(v('pest_instance'), 718);
for (const name of ['pest_points', 'pest_activity', 'pest_instance']) assert.equal(types.VarPlayerType.get(v(name)).transmit, false, `${name} never changes client configuration`);
assert.equal(types.VarPlayerType.get(v('pest_points')).scope, types.VarPlayerType.SCOPE_PERM);
assert.notEqual(types.VarPlayerType.get(v('pest_activity')).scope, types.VarPlayerType.SCOPE_PERM, 'per-match activity never becomes saved progress');

// The expected coordinates come from original map geometry, not product constants.
walkable(2660, 2640, 0, 2662, 2642, 'waiting craft');
walkable(2657, 2639, 0, 2659, 2647, 'outpost pier');
walkable(2658, 2611, 0, 2657, 2606, 'match craft');
walkable(3042, 3203, 0, 3030, 3203, 'Port Sarim arrival to mainland pier');
walkable(2658, 2676, 0, 2658, 2670, 'outpost arrival to pier exit');
for (const [ordinal, [x, z]] of [[4, 31], [56, 28], [45, 10], [21, 9]].entries()) {
  walkable(2624 + x - 1, 2560 + z + 1, 0, 2624 + x - 1, 2560 + z + 2, `portal${ordinal + 1} combat approach`);
}
walkable(2651, 2592, 0, 2650, 2591, 'barricade repair approach');
walkable(2656, 2584, 0, 2656, 2583, 'original south gate repair approach');
walkable(2657, 2584, 0, 2657, 2583, 'original south gate open/close approach');

// Real ordinary PvM labels still damage their target without Pest Control credit.
{
  const p = player();
  try {
    const target = npcs('black_demon')[0];
    assert(target, 'ordinary packed black demon exists');
    write(p, 'pest_activity', 17);
    equip(p, 'rune_scimitar'); proc(p, 'update_all', [obj('rune_scimitar')]);
    nativeHit(p, target, 'melee', false);
    p.getInventory(worn).removeAll();
    equip(p, 'shortbow'); equip(p, 'bronze_arrow', 10); proc(p, 'update_all', [obj('shortbow')]);
    nativeHit(p, target, 'ranged', false);
    p.getInventory(worn).removeAll();
    p.invAdd(inv, obj('airrune'), 10); p.invAdd(inv, obj('mindrune'), 10);
    proc(p, 'update_all', [-1]);
    nativeHit(p, target, 'magic', false);
    assert.equal(read(p, 'pest_instance'), 0, 'ordinary combat never joins a match');
  } finally { cleanup(p); }
}

{
  const p = player();
  try {
    move(p, 3042, 3203);
    assert.equal(proc(p, 'pest_teleport_check', [packed(p.x, p.z)]).popInt(), 1, 'ordinary mainland teleports remain eligible');
    write(p, 'pest_points', 12);
    write(p, 'pest_activity', 50);
    proc(p, 'pest_login');
    assert.equal(read(p, 'pest_points'), 12, 'login preserves saved commendations');
    assert.equal(read(p, 'pest_activity'), 0, 'login discards stale match activity');
    assert.deepEqual(tile(p), [0, 3042, 3203], 'ordinary mainland login does not move a player');
  } finally { cleanup(p); }
}

{
  const p = player();
  try {
    const sarimSquire = npcs('pest_squire_ship_portsarim')[0];
    const islandSquire = npcs('pest_squire_ship_island')[0];
    assert(sarimSquire && islandSquire, 'both original travel Squires exist on real packed maps');
    npcOp(p, sarimSquire);
    assert.deepEqual(tile(p), [0, 2658, 2676], 'native Squire operation reaches outpost');
    npcOp(p, islandSquire);
    assert.deepEqual(tile(p), [0, 3042, 3203], 'native return operation reaches Port Sarim');
    p.baseLevels.fill(1); p.levels.fill(1); p.stats.fill(0);
    for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS]) {
      p.baseLevels[stat] = p.levels[stat] = 34; p.stats[stat] = getExpByLevel(34);
    }
    assert.equal(proc(p, 'player_combat_level').popInt(), 39, 'independent boundary fixture is combat39');
    move(p, 2657, 2639);
    locOp(p, locNamed('pest_lander_gangplank', 2658, 2639));
    assert.equal(read(p, 'pest_instance'), 0, 'combat below40 cannot board');
    assert.deepEqual(tile(p), [0, 2657, 2639], 'combat refusal cannot teleport');
    for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS]) {
      p.baseLevels[stat] = p.levels[stat] = 35; p.stats[stat] = getExpByLevel(35);
    }
    assert.equal(proc(p, 'player_combat_level').popInt(), 40, 'independent boundary fixture is combat40');
    board(p);
    locOp(p, locNamed('pest_lander_ladder', 2660, 2639));
    p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(getExpByLevel(99));
    board(p);
    locOp(p, locNamed('pest_lander_ladder', 2660, 2639));
    assert.equal(read(p, 'pest_instance'), 0, 'ladder exits queue');
    assert.deepEqual(tile(p), [0, 2657, 2639]);
    board(p);
    execute('[logout,_]', p);
    assert.equal(read(p, 'pest_instance'), 0, 'ordinary logout releases queue');
    board(p);
    proc(p, 'pest_login');
    assert.equal(read(p, 'pest_instance'), 0, 'login cannot strand a waiting player');
  } finally { cleanup(p); }
}
{
  const p = player(), q = player();
  try {
    board(p); board(q);
    const knight = depart(p, q);
    const instance = read(p, 'pest_instance');
    assert.equal(read(q, 'pest_instance'), instance, 'same boat shares one isolated match');
    assert.equal(World.gameMap.isMultiZone(World.gameMap.getZone(p.x, p.z, p.level).index), true, 'copied arena retains cooperative multiway');
    const portals = [...World.npcs].filter(n => /^pest_portal_[1-4]_active$/.test(types.NpcType.get(n.type).debugname) && World.instances.findInstanceByCoord(n)?.uid === instance - 1);
    assert.equal(portals.length, 4, 'all four genuine original portals spawn');
    seed(p, ['hammer', 'logs', 'coins', 'shark', 'rune_scimitar']);
    equip(p, 'rune_platebody');
    const full = { inv: inventory(p), worn: inventory(p, worn) };
    p.levels[PlayerStat.HITPOINTS] = 0; // Offline lethal fixture reaches the real death dispatcher.
    p.levels[PlayerStat.DEFENCE] = 1;
    p.runenergy = 0;
    execute('[queue,player_death_default]', p);
    assert.deepEqual(inventory(p), full.inv, 'shared death dispatcher keeps every inventory item');
    assert.deepEqual(inventory(p, worn), full.worn, 'shared death dispatcher keeps every equipped item');
    assert.equal(p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS], 'safe death restores HP');
    assert.equal(p.levels[PlayerStat.DEFENCE], p.baseLevels[PlayerStat.DEFENCE], 'safe death restores drained stats');
    assert.equal(p.runenergy, 10000, 'safe death uses hundredths of a percent for full energy');
    assert.equal(read(p, 'pest_instance'), instance, 'safe death remains in own match');
    const region = World.instances.findInstanceByUid(instance - 1);
    assert.deepEqual(tile(p), [0, region.sw.x + 34, region.sw.z + 51], 'safe death respawns on original match lander');
    assert.equal(proc(p, 'pest_teleport_check', [packed(p.x, p.z)]).popInt(), 0, 'teleport cannot discard safe match state');
    assert.equal(read(p, 'pest_instance'), instance, 'eligibility check has no cleanup side effect');
    // Activity produced by the compiled repair/damage path is tested below.
    proc(p, 'pest_activity', [49]);
    proc(q, 'pest_activity', [50]);
    const pCoins = count(p, 'coins'), qCoins = count(q, 'coins');
    knight.setVar(nv('pest_end_clock'), World.currentTick);
    runNpc(knight, '[ai_timer,pest_voidknight_control1]');
    drain(p, q);
    assert.equal(read(p, 'pest_points'), 0, '49 damage earns no commendation');
    assert.equal(count(p, 'coins'), pCoins, '49 damage earns no coins');
    assert.equal(read(q, 'pest_points'), 1, 'surviving20minutes with50activity earns one commendation');
    assert.equal(count(q, 'coins') - qCoins, 1260, 'eligible126combat victory grants exactly10×combat coins');
    assert.deepEqual(tile(q), [0, 2657, 2639], 'victory returns to walkable dock');
    assert.equal(World.instances.findInstanceByUid(instance - 1), null, 'last participant departure destroys entire match');
    assert.equal(read(p, 'pest_activity'), 0, 'activity cannot carry into another match');
  } finally { cleanup(p); cleanup(q); }
}
// Native queued damage and Npc.turn(), not a manually invoked death/timer label.
// Hold player turns until both the death handler and the next timer have run,
// proving they share one result per participant even at the final deadline.
for (let phase = 0; phase < 5; phase++) {
  const players = [player(), player()];
  try {
    for (const p of players) board(p);
    const knight = depart(...players);
    const instance = read(players[0], 'pest_instance');
    const coins = players.map(p => count(p, 'coins'));
    knight.timerClock = phase;
    const hp = knight.levels[PlayerStat.HITPOINTS];
    assert(hp > 0, 'product spawns a living Knight before the lethal hit');
    knight.enqueueScript(Trigger.AI_QUEUE2, 0, hp);
    for (let turn = 0; turn < 6; turn++) {
      World.currentTick++;
      knight.turn();
      if (turn === 0) {
        assert.equal(knight.levels[PlayerStat.HITPOINTS], 0, `phase${phase}: native queued hit kills the Knight`);
        // Controlled deadline only: the real damage queue produced HP zero.
        knight.setVar(nv('pest_end_clock'), World.currentTick);
      }
    }
    assert.equal(knight.getVar(nv('pest_result')), 2, `phase${phase}: natural Knight death loses even at expiry`);
    assert(knight.isActive, `phase${phase}: controller survives until participants consume their result`);
    for (const p of players) {
      const finishes = [...p.queue.all()].filter(request => request.script.name === '[queue,pest_finish]');
      assert.equal(finishes.length, 1, `phase${phase}: native death/timer race queues each participant exactly once`);
      // Native longqueue prepends its logout policy to the script arguments.
      assert.equal(finishes[0].args[3], 2, `phase${phase}: queued result is a loss`);
    }
    drain(...players);
    for (const [index, p] of players.entries()) {
      assert.equal(read(p, 'pest_instance'), 0, `phase${phase}: natural loss releases every participant`);
      assert.equal(read(p, 'pest_points'), 0, `phase${phase}: natural loss awards no commendation`);
      assert.equal(count(p, 'coins'), coins[index], `phase${phase}: natural loss awards no coins`);
      assert.deepEqual(tile(p), [0, 2657, 2639], `phase${phase}: natural loss returns every participant to the dock`);
    }
    assert.equal(World.instances.findInstanceByUid(instance - 1), null, `phase${phase}: natural loss reclaims the empty match`);
    assert.equal(knight.isActive, false, `phase${phase}: region cleanup removes the dead controller`);
  } finally { for (const p of players) cleanup(p); }
}
console.log('PASS natural Void Knight death: native damage queue and NPC turns, all five timer alignments, one loss per participant');
{
  const p = player();
  try {
    board(p); depart(p);
    const old = read(p, 'pest_instance');
    execute('[logout,_]', p);
    assert.equal(read(p, 'pest_instance'), 0, 'ordinary logout releases active match');
    assert.equal(World.instances.findInstanceByUid(old - 1), null, 'logout destroys an empty match');
    board(p); depart(p);
    const squire = npcs('pest_squire_instance').find(n => World.instances.findInstanceByCoord(n)?.uid === read(p, 'pest_instance') - 1);
    npcOp(p, squire);
    assert.equal(read(p, 'pest_instance'), 0, 'real match Squire exits safely');
  } finally { cleanup(p); }
}

{
  const players = Array.from({ length: 26 }, () => player());
  try {
    for (let index = players.length - 1; index >= 0; index--) board(players[index]);
    depart(...players.slice(0, 25));
    const first = read(players[0], 'pest_instance');
    assert.equal(new Set(players.slice(0, 25).map(p => read(p, 'pest_instance'))).size, 1, 'one boat owns one match');
    assert.equal(read(players[25], 'pest_instance'), -1, '26th volunteer remains safely queued');
    assert.equal(read(players[25], 'pest_activity'), -1, 'left-behind player receives next-boat priority');
    const waitingSquire = npcs('pest_squire_lander')[0];
    runNpc(waitingSquire, '[ai_timer,pest_squire_lander]');
    const secondKnight = depart(players[25]);
    const second = read(players[25], 'pest_instance');
    assert.notEqual(second, first, 'concurrent boats never share a region');
    runNpc(knightFor(players[0]), '[proc,pest_match_finish]', [2]);
    drain(...players);
    assert.equal(read(players[25], 'pest_instance'), second, 'ending one match cannot eject another boat');
    assert.equal(knightFor(players[25]), secondKnight, 'unrelated match retains its own knight');
    assert.equal(World.instances.findInstanceByUid(first - 1), null, 'all25 departures reclaim their match');
    runNpc(secondKnight, '[proc,pest_match_finish]', [2]);
    drain(...players);
    for (let index = players.length - 1; index >= 0; index--) board(players[index]);
    depart(...players.slice(0, 25));
    // Rejoin25 lower hunt-order players ahead of the previously left-behind26th.
    for (const p of players.slice(0, 25)) { proc(p, 'pest_leave'); board(p); }
    depart(players[25], ...players.slice(1, 25));
    assert(read(players[25], 'pest_instance') > 0, 'old waiting volunteer boards before25 newly joined volunteers');
    assert.equal(read(players[0], 'pest_instance'), -1, 'priority displaces a new volunteer when the boat is full');
  } finally { for (const p of players) cleanup(p); }
}

{
  const p = player();
  try {
    seed(p, ['hammer', 'logs', 'coins', 'shark', 'rune_scimitar', 'rune_platelegs']);
    equip(p, 'rune_platebody');
    const before = { inv: inventory(p), worn: inventory(p, worn) };
    board(p);
    const knight = depart(p);
    // Real queue ordering: a match result can already precede a lethal-hit death.
    runNpc(knight, '[proc,pest_match_finish]', [2]);
    p.levels[PlayerStat.HITPOINTS] = 0;
    proc(p, 'player_die');
    for (let n = 0; n < 10; n++) environmentTick(p);
    assert.deepEqual(inventory(p), before.inv, 'match-end/death race never enters ordinary item-loss allocation');
    assert.deepEqual(inventory(p, worn), before.worn, 'match-end/death race keeps worn equipment');
    assert(p.levels[PlayerStat.HITPOINTS] > 0, 'simultaneous match end and death restores health');
    assert.deepEqual(tile(p), [0, 2657, 2639], 'pending death cannot teleport a returned player to Lumbridge');
    assert.equal(read(p, 'death'), 0, 'no pending death state survives match return');
  } finally { cleanup(p); }
}

{
  const p = player();
  try {
    const trader = npcs('pest_voidknight_1')[0];
    assert(trader, 'original outpost exchange knight exists on the real map');
    move(p, trader.x - 1, trader.z);
    // XP is not an item: every original icon and duplicate text button must work
    // even with a full inventory, without giving any post-June item pack.
    for (let slot = 0; slot < 28; slot++) p.invAdd(inv, obj('hammer'), 1);
    const skillOrder = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.RANGED, PlayerStat.MAGIC, PlayerStat.HITPOINTS, PlayerStat.PRAYER];
    for (let duplicate = 0; duplicate < 2; duplicate++) {
      for (let choice = 0; choice < skillOrder.length; choice++) {
        write(p, 'pest_points', 1);
        npcOp(p, trader, 3);
        const before = [...p.stats], items = inventory(p);
        const level = p.baseLevels[skillOrder[choice]];
        const expectedXp = Math.floor(level * level / 600) * (choice === 6 ? 50 : 100) * 10;
        button(p, `void_knights_training:com_${68 + choice + duplicate * 7}`);
        button(p, 'void_knights_training:com_87');
        drain(p);
        assert.equal(read(p, 'pest_points'), 0, 'native confirmation spends exactly one commendation');
        for (let stat = 0; stat < before.length; stat++) {
          if (stat === skillOrder[choice]) assert.equal(p.stats[stat] - before[stat], expectedXp, 'selected skill receives exact approved pre-2007 XP in tenths');
          else assert.equal(p.stats[stat], before[stat], 'all other skills remain unchanged');
        }
        assert.deepEqual(inventory(p), items, 'original377 exchange never consumes inventory or invents a pack');
      }
    }
    npcOp(p, trader, 3);
    button(p, 'void_knights_training:com_68');
    const before = [...p.stats];
    button(p, 'void_knights_training:com_87');
    drain(p);
    assert.equal(read(p, 'pest_points'), 0, 'insufficient points never go negative');
    assert.deepEqual([...p.stats], before, 'insufficient points grant no XP');
    write(p, 'pest_points', 1);
    p.baseLevels[PlayerStat.ATTACK] = p.levels[PlayerStat.ATTACK] = 24;
    p.stats[PlayerStat.ATTACK] = getExpByLevel(24);
    npcOp(p, trader, 3);
    button(p, 'void_knights_training:com_87');
    drain(p);
    assert.equal(read(p, 'pest_points'), 1, 'confirmation without a selection cannot spend a point');
    button(p, 'void_knights_training:com_68');
    const lowXp = p.stats[PlayerStat.ATTACK];
    button(p, 'void_knights_training:com_87');
    drain(p);
    assert.equal(read(p, 'pest_points'), 1, 'skill24 cannot redeem a commendation');
    assert.equal(p.stats[PlayerStat.ATTACK], lowXp, 'skill24 refusal grants no XP');
    p.baseLevels[PlayerStat.ATTACK] = p.levels[PlayerStat.ATTACK] = 25;
    p.stats[PlayerStat.ATTACK] = getExpByLevel(25);
    const redeemXp = p.stats[PlayerStat.ATTACK];
    button(p, 'void_knights_training:com_87');
    drain(p);
    assert.equal(read(p, 'pest_points'), 0, 'skill25 may redeem exactly one point');
    assert.equal(p.stats[PlayerStat.ATTACK] - redeemXp, 1000, 'level25 receives100XP, stored in tenths');
    button(p, 'void_knights_training:com_87');
    drain(p);
    assert.equal(p.stats[PlayerStat.ATTACK] - redeemXp, 1000, 'replayed confirmation cannot spend the same point twice');
    p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(getExpByLevel(99));
    const bank = id('InvType', 'bank');
    proc(p, 'pest_award');
    assert.equal(count(p, 'coins'), 0, 'full inventory does not silently lose or replace carried items');
    assert.equal(count(p, 'coins', bank), 1260, 'full-inventory coin reward is delivered to the bank');
    const bankInventory = p.getInventory(bank);
    bankInventory.removeAll();
    const bankItems = types.ObjType.configs.filter(type => type && type.name && type.tradeable && type.dummyitem === 0 && type.certtemplate === -1 && type.id !== obj('coins')).slice(0, types.InvType.get(bank).size);
    assert.equal(bankItems.length, types.InvType.get(bank).size, 'real distinct normal items fill a reachable full-bank fixture');
    for (const type of bankItems) p.invAdd(bank, type.id, 1);
    const fullBank = inventory(p, bank), fullBag = inventory(p);
    move(p, 2657, 2639);
    proc(p, 'pest_award');
    const privateCoins = World.getObj(p.x, p.z, p.level, obj('coins'), p.hash64);
    assert(privateCoins, 'full inventory and full bank still deliver the coin reward at the returned dock');
    assert.equal(privateCoins.count, 1260, 'ground fallback delivers the entire coin award');
    assert.equal(World.getObj(p.x, p.z, p.level, obj('coins'), p.hash64 + 1n), null, 'overflow award is initially private to its winner');
    assert.deepEqual(inventory(p), fullBag, 'ground fallback never overwrites carried items');
    assert.deepEqual(inventory(p, bank), fullBank, 'ground fallback never overwrites banked items');
    World.removeObj(privateCoins, 0);
    p.getInventory(inv).removeAll();
    write(p, 'pest_points', 14);
    proc(p, 'pest_award');
    assert.equal(read(p, 'pest_points'), 15, 'original commendation cap is15');
    proc(p, 'pest_award');
    assert.equal(read(p, 'pest_points'), 15, 'another win never raises the cap');
    assert.equal(count(p, 'coins'), 2520, 'each eligible win pays coins even at the commendation cap');
  } finally { cleanup(p); }
}

{
  const p = player(), q = player();
  try {
    board(p); board(q);
    const knight = depart(p, q), instance = read(p, 'pest_instance');
    const region = World.instances.findInstanceByUid(instance - 1);
    const inMatch = name => npcs(name).find(n => World.instances.findInstanceByCoord(n)?.uid === instance - 1);
    const portals = [1, 2, 3, 4].map(n => inMatch(`pest_portal_${n}_active`));
    const families = ['pest_splatter_1', 'pest_shifter_1a', 'pest_ravager_1', 'pest_spinner_1', 'pest_torcher_1a', 'pest_defiler_1a', 'pest_brawler_1'];
    const pests = families.map(name => { const npc = inMatch(name); assert(npc, `${name}: product spawns original family`); return npc; });
    for (const [index, [x, z]] of [[4, 31], [56, 28], [45, 10], [21, 9]].entries()) {
      assert.deepEqual([portals[index].x, portals[index].z], [region.sw.x + x, region.sw.z + z], 'actual portal occupies intended original pad');
      assert(portals[index].baseLevels[PlayerStat.HITPOINTS] > 1, 'portal HP and health bar use real server base stats');
    }
    const blockedPestTiles = [];
    for (const [index, pest] of pests.entries()) for (let x = pest.x; x < pest.x + pest.width; x++) for (let z = pest.z; z < pest.z + pest.length; z++) {
      const blocked = routeFinder.collisionFlags.get(x, z, pest.level) & (F.FLOOR | F.LOC);
      if (blocked) blockedPestTiles.push([families[index], x - region.sw.x, z - region.sw.z, blocked]);
    }
    assert.deepEqual(blockedPestTiles, [], 'entire original Pest footprints spawn on walkable terrain');
    for (const pest of pests) for (const portal of portals) {
      assert(!(pest.x < portal.x + portal.width && pest.x + pest.width > portal.x && pest.z < portal.z + portal.length && pest.z + pest.length > portal.z), 'no Pest spawns trapped inside a blocking portal footprint');
    }
    for (const [index, pest] of pests.entries()) for (const other of pests.slice(index + 1)) {
      assert(!(pest.x < other.x + other.width && pest.x + pest.width > other.x && pest.z < other.z + other.length && pest.z + pest.length > other.z), 'simultaneous Pests never spawn inside another blocking Pest footprint');
    }
    const brawler = pests[6];
    assert(routeFinder.collisionFlags.get(brawler.x, brawler.z, brawler.level) & F.NPC_OCC, 'Brawler contributes real NPC blocking collision');
    for (const actor of [...pests, ...portals]) {
      assert(routeFinder.collisionFlags.get(actor.x, actor.z, actor.level) & F.BLOCK_NPC_AND_PLAYERS, 'pre-2007 Pests and portals also block players');
    }
    equip(p, 'rune_scimitar'); proc(p, 'update_all', [obj('rune_scimitar')]);
    nativeHit(p, portals[0], 'melee');
    p.getInventory(worn).removeAll();
    equip(p, 'shortbow'); equip(p, 'bronze_arrow', 1000); proc(p, 'update_all', [obj('shortbow')]);
    nativeHit(p, portals[0], 'ranged');
    p.clearInteraction();
    p.invAdd(inv, obj('logs'), 2);
    q.invAdd(inv, obj('airrune'), 10); q.invAdd(inv, obj('mindrune'), 10);
    proc(q, 'update_all', [-1]);
    const otherActivity = read(p, 'pest_activity');
    nativeHit(q, portals[0], 'magic');
    assert.equal(read(p, 'pest_activity'), otherActivity, 'another participant never earns the top loot hero their damage credit');
    assert(read(q, 'pest_activity') > 0, 'a smaller contributor receives their own damage credit');
    const beforeExcluded = read(p, 'pest_activity');
    proc(p, 'pest_hit_activity', [10], knight);
    assert.equal(read(p, 'pest_activity'), beforeExcluded, 'defending Knight cannot manufacture attacking activity');

    const barricadeX = region.sw.x + 28, barricadeZ = region.sw.z + 32;
    const craftXp = p.stats[PlayerStat.CRAFTING], repairActivity = read(p, 'pest_activity');
    locOp(p, locNamed('pest_barricade_damaged', barricadeX, barricadeZ), 3);
    assert.equal(count(p, 'logs'), 2, 'no-hammer refusal cannot consume a log');
    assert.equal(p.stats[PlayerStat.CRAFTING], craftXp, 'no-hammer refusal grants no XP');
    assert.equal(read(p, 'pest_activity'), repairActivity, 'no-hammer refusal grants no activity');
    p.invAdd(inv, obj('hammer'), 1);
    locOp(p, locNamed('pest_barricade_damaged', barricadeX, barricadeZ), 3);
    locNamed('pest_barricade_fixed', barricadeX, barricadeZ);
    assert.equal(count(p, 'logs'), 1, 'native barricade repair consumes one log');
    assert.equal(count(p, 'hammer'), 1, 'native repair keeps its hammer');
    assert.equal(p.stats[PlayerStat.CRAFTING] - craftXp, 10, 'Crafting reward uses XP tenths');
    assert.equal(read(p, 'pest_activity'), Math.min(50, repairActivity + 5), 'one repaired section contributes exactly5 damage');
    locOp(p, locNamed('pest_wall_gate_damaged_1', region.sw.x + 32, region.sw.z + 25));
    locOp(p, locNamed('pest_wall_gate_damaged_1_open', region.sw.x + 32, region.sw.z + 25), 3);
    const repairedOpenGate = locNamed('pest_wall_gate_fixed_open', region.sw.x + 32, region.sw.z + 25);
    assert.equal(repairedOpenGate.angle, 0, 'repair preserves the open leaf orientation');
    locOp(p, repairedOpenGate);
    assert.equal(locNamed('pest_wall_gate_fixed', region.sw.x + 32, region.sw.z + 25).angle, 3, 'closing the repaired gate restores its original orientation');
    assert.equal(count(p, 'logs'), 0, 'native gate repair consumes its own log');
    assert.equal(p.stats[PlayerStat.CRAFTING] - craftXp, 20, 'two repairs grant exactly2XP');
    const gateX = region.sw.x + 33, gateZ = region.sw.z + 25;
    const closedFlags = routeFinder.collisionFlags.get(gateX, gateZ, 0);
    locOp(p, locNamed('pest_wall_gate_fixed_mirror', gateX, gateZ));
    const open = locNamed('pest_wall_gate_fixed_mirror_open', gateX, gateZ);
    assert.notEqual(routeFinder.collisionFlags.get(gateX, gateZ, 0), closedFlags, 'opening changes real gate collision');
    const crossing = [...map.findPath(0, gateX, gateZ - 1, gateX, gateZ + 1)];
    assert.deepEqual(crossing, [packed(gateX, gateZ + 1)], 'opened original gate permits a straight crossing through the real fort entrance');
    locOp(p, open);
    locNamed('pest_wall_gate_fixed_mirror', gateX, gateZ);
    assert.equal(routeFinder.collisionFlags.get(gateX, gateZ, 0), closedFlags, 'closing restores original gate collision');

    move(q, region.sw.x + 34, region.sw.z + 51);
    incomingHit(p, pests[4], 'prayer13', false);
    incomingHit(p, pests[4], 'prayer12', true);
    incomingHit(p, pests[5], 'prayer12', false);
    incomingHit(p, pests[5], 'prayer13', true);

    const spinner = pests[3], healPortal = portals[3];
    damageNpc(p, healPortal, 5);
    const hurt = healPortal.levels[PlayerStat.HITPOINTS];
    npcTimer(spinner);
    assert(healPortal.levels[PlayerStat.HITPOINTS] > hurt, 'native Spinner timer heals a nearby live portal');
    assert(healPortal.levels[PlayerStat.HITPOINTS] <= healPortal.baseLevels[PlayerStat.HITPOINTS], 'Spinner never overheals beyond portal max HP');
    const ravager = pests[2];
    let reachedGate = false;
    for (let step = 0; step < 80; step++) {
      // Native cycle resets release spawn teleport state; the blocking neighbour must also move.
      ravager.resetEntity(false);
      brawler.resetEntity(false);
      World.currentTick++;
      brawler.turn();
      ravager.turn();
      if ([...World.gameMap.getZone(region.sw.x + 46, region.sw.z + 32, 0).getAllLocsSafe()].some(l => types.LocType.get(l.type).debugname === 'pest_wall_gate_damaged_1' && l.x === region.sw.x + 46 && l.z === region.sw.z + 32)) {
        reachedGate = true;
        break;
      }
    }
    assert(reachedGate, `real Ravager movement reaches and damages the original outer gate from its native spawn: ${JSON.stringify({ x: ravager.x - region.sw.x, z: ravager.z - region.sw.z, active: ravager.isActive, delayed: ravager.delayed, timer: ravager.timerClock, interval: ravager.timerInterval, mode: ravager.targetOp, waypoint: ravager.waypointIndex })}`);
    const damagedGate = locNamed('pest_wall_gate_damaged_1', region.sw.x + 46, region.sw.z + 32);
    const refusedXp = p.stats[PlayerStat.CRAFTING], refusedActivity = read(p, 'pest_activity');
    locOp(p, damagedGate, 3);
    assert.equal(p.stats[PlayerStat.CRAFTING], refusedXp, 'no-log repair grants no XP');
    assert.equal(read(p, 'pest_activity'), refusedActivity, 'no-log repair grants no activity');
    locNamed('pest_wall_gate_damaged_1', region.sw.x + 46, region.sw.z + 32);
    p.invAdd(inv, obj('logs'), 1);
    locOp(p, damagedGate, 3);
    locNamed('pest_wall_gate_fixed', region.sw.x + 46, region.sw.z + 32);
    npcTimer(ravager); npcTimer(ravager);
    locNamed('pest_wall_gate_destroyed', region.sw.x + 46, region.sw.z + 32);
    assert.deepEqual([...map.findPath(0, region.sw.x + 47, region.sw.z + 32, region.sw.x + 45, region.sw.z + 32)], [packed(region.sw.x + 45, region.sw.z + 32)], 'Ravager destruction opens a real path through the original fort gate');
    const shifter = pests[1], oldShifter = [shifter.x, shifter.z];
    World.currentTick = Math.ceil((World.currentTick + 1) / 200) * 200;
    npcTimer(shifter);
    assert.notDeepEqual([shifter.x, shifter.z], oldShifter, 'native Shifter timer really teleports');
    assert(Math.max(Math.abs(shifter.x - knight.x), Math.abs(shifter.z - knight.z)) <= 2, 'Shifter reaches the defended Knight rather than an unrelated player');
    const splatter = pests[0];
    move(p, splatter.x - 1, splatter.z);
    move(q, region.sw.x + 34, region.sw.z + 51);
    const hp = p.levels[PlayerStat.HITPOINTS], distantHp = q.levels[PlayerStat.HITPOINTS];
    damageNpc(p, splatter, 1000); deathNpc(splatter); drain(p, q);
    assert(p.levels[PlayerStat.HITPOINTS] < hp, 'real Splatter death damages an adjacent player');
    assert.equal(q.levels[PlayerStat.HITPOINTS], distantHp, 'Splatter splash does not hit a distant participant');
    knight.levels[PlayerStat.HITPOINTS] -= 20; // Offline injury fixture checks portal-death healing.
    const knightHp = knight.levels[PlayerStat.HITPOINTS];
    for (const [index, portal] of portals.entries()) {
      for (let strike = 0; portal.levels[PlayerStat.HITPOINTS] > 0 && strike < 60; strike++) nativeHit(p, portal, 'ranged');
      assert.equal(portal.levels[PlayerStat.HITPOINTS], 0, 'real capped player hits destroy the portal');
      deathNpc(portal);
      assert.equal(inMatch(`pest_portal_${index + 1}_active`), undefined, 'destroyed portal loses its attackable active form');
      if (index === 0) assert(knight.levels[PlayerStat.HITPOINTS] > knightHp, 'portal destruction heals the defended Knight');
      if (index === 0) {
        const beforeSpawn = new Set(World.npcs);
        World.currentTick = Math.ceil((World.currentTick + 1) / 50) * 50;
        runNpc(knight, '[ai_timer,pest_voidknight_control1]');
        const spawned = [...World.npcs].filter(n => !beforeSpawn.has(n) && n.isActive && families.includes(types.NpcType.get(n.type).debugname));
        assert.equal(spawned.length, 1, 'native controller fills the real Pest vacancy at its spawn interval');
        assert(spawned.every(n => n.x >= region.sw.x + 10 || Math.abs(n.z - (region.sw.z + 31)) > 3), 'destroyed west portal never spawns a replacement Pest');
      }
    }
    runNpc(knight, '[ai_timer,pest_voidknight_control1]');
    drain(p, q);
    assert.equal(read(p, 'pest_points'), 1, 'four native portal deaths award exactly one eligible commendation');
    assert.equal(read(q, 'pest_points'), 0, 'small contributor still fails50damage on portal victory');
    assert.equal(count(p, 'coins'), 1260, 'portal victory pays the exact ordinary coin reward');
    assert.deepEqual(tile(p), [0, 2657, 2639], 'portal victory returns the player to the original dock');
    assert.equal(World.instances.findInstanceByUid(instance - 1), null, 'portal victory reclaims every actor and fort with its empty instance');
  } finally { cleanup(p); cleanup(q); }
}

console.log('PASS Pest Control: packed landings, original slots, native dispatch, boarding, grouped private departure, safe death, timeout victory, activity gate, knight loss, logout and exit');
process.exit(0);
