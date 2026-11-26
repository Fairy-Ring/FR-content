#!/usr/bin/env node
/** Q079 and N557/N558: compiled scripts and real original-map dispatch, no server. */
import './test_tog_quest.mjs';
import assert from 'node:assert/strict';
import { World, ScriptProvider, PlayerStat, PlayerTimerType, types, map, CollisionType,
  engineModule, id, obj, inv, worn, player, seed, count, execute, tile, environmentTick,
  startDialogue, resumeDialogue, dialoguePage } from '../swamp-caves/runtime.mjs';
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const { ScriptOpcode } = await engineModule('engine/script/ScriptOpcode.ts');
const ScriptVarType = (await engineModule('cache/config/ScriptVarType.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new ((await engineModule('network/game/client/handler/OpLocHandler.ts')).default)();
const { getExpByLevel } = await engineModule('engine/entity/Player.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
World.vars = new Int32Array(types.VarSharedType.count);
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const rsbuf = await engineModule('network/rsbuf/index.ts');
const clockHandler = ScriptRunner.HANDLERS[ScriptOpcode.DATE_MINUTES];
let minute = 30_000_000;
ScriptRunner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
const vp = name => id('VarPlayerType', name), vb = name => id('VarBitType', name);
const get = (p, name) => p.getVarBit(vb(name));
const set = (p, name, value) => p.setVarBit(vb(name), value);
const shared = name => id('VarSharedType', name);
const timer = ScriptProvider.getByName('[timer,tog_session_tick]');
const hud = id('Component', 'water_collected');
const walls = [[3257,9514,1], [3257,9520,3], [3258,9514,1], [3258,9520,3],
  [3259,9514,1], [3259,9520,3], [3261,9516,0], [3261,9517,0], [3261,9518,0]];
let cases = 0;
function test(name, run) { run(); cases++; console.log(`PASS ${name}`); }
function fixture() {
  const p = player();
  for (let i = 0; i < types.VarPlayerType.count; i++) {
    const type = types.VarPlayerType.get(i).type;
    if (type !== ScriptVarType.INT && type !== ScriptVarType.STRING) p.vars[i] = -1;
  }
  p.level = 2; p.x = 3251; p.z = 9516; p.originX = p.x; p.originZ = p.z;
  p.setVar(vp('qp'), 43); set(p, 'tog_juna_bowl', 2);
  p.baseLevels.fill(50); p.levels.fill(50);
  p.baseLevels[PlayerStat.FARMING] = 30; p.levels[PlayerStat.FARMING] = 30;
  // Keep the native XP/base-level fixture coherent when XP recalculates its level.
  p.stats.fill(1_013_330); p.stats[PlayerStat.FARMING] = 133_630;
  World.vars[shared('tog_stream_next_tick')] = 0;
  return p;
}
function finish(p) {
  p.delayed = false; p.activeScript = null; p.weakQueue.clear(); p.clearInteraction();
  p.timers.clear(); rsbuf.removePlayer(p.slot); p.isActive = false;
  World.players[p.pid] = null; p.unlink();
}
function result(name, p, args = []) { return execute(name, p, args).popInt(); }
function ticks(p, n) { for (let i = 0; i < n; i++) environmentTick(p); }
function enter(p) { execute('[proc,tog_session_enter]', p); assert.equal(get(p, 'tog_minigame_collecting'), 1); }
function mask(name) { return World.vars[shared(name)]; }
function freezeStreams(blue, green) {
  World.vars[shared('tog_stream_next_tick')] = World.currentTick + 1000;
  World.vars[shared('tog_stream_blue_mask')] = blue;
  World.vars[shared('tog_stream_green_mask')] = green;
}
function collect(p, index) {
  const [x,z] = walls[index]; p.x = x === 3261 ? x - 1 : x;
  p.z = z === 9514 ? z + 1 : z === 9520 ? z - 1 : z;
  p.originX = p.x; p.originZ = p.z; p.lastMovement = -1;
  const wall = World.getLoc(x, z, 2, id('LocType', 'tog_weepingwall')); assert(wall);
  assert(locHandler.handle(new OpLoc(1, x, z, wall.type), p), 'native wall packet accepted');
  p.processInteraction();
}
function chamberTiles() {
  const tiles = [[3256,9517]], seen = new Set(['3256,9517']);
  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let next = 0; next < tiles.length; next++) {
    const [x,z] = tiles[next];
    for (const [dx,dz] of directions) {
      if (!map.canTravel(2,x,z,dx,dz,1,0,CollisionType.NORMAL)) continue;
      const key = `${x+dx},${z+dz}`;
      if (seen.has(key)) continue;
      seen.add(key); tiles.push([x+dx,z+dz]);
      assert(tiles.length <= 256, 'the session chamber is enclosed');
    }
  }
  return tiles;
}
function walk(p, x, z) {
  const route = Array.from(map.findPath(p.level,p.x,p.z,x,z), packed => {
    const point = CoordGrid.unpackCoord(packed); return { x: point.x, z: point.z };
  });
  assert(route.length, `native route to ${x},${z}`);
  p.originX = p.x; p.originZ = p.z;
  assert(moveHandler.handle(new MoveClick(route,0,false),p), 'native Walk-here accepted');
  const collecting = [];
  for (let step = 0; step < 16 && (p.x !== x || p.z !== z); step++) {
    p.updateMovement(); environmentTick(p); collecting.push(get(p,'tog_minigame_collecting'));
  }
  assert.deepEqual(tile(p),[2,x,z], 'native movement reaches its destination');
  return collecting;
}
try {
  test('original identities and collision-safe session entry/exit', () => {
    assert.equal(vp('tog_minigame'), 449); assert.equal(vp('tog_last_visit_minute'), 244);
    assert.equal(vp('tog_last_total_level'), 245);
    for (const name of ['tog_minigame','tog_last_visit_minute','tog_last_total_level'])
      assert.equal(types.VarPlayerType.get(vp(name)).scope, types.VarPlayerType.SCOPE_PERM);
    assert.equal(types.VarPlayerType.get(vp('tog_last_visit_minute')).transmit, false);
    assert.equal(types.VarPlayerType.get(vp('tog_last_total_level')).transmit, false);
    for (const [x,z] of [[3256,9517],[3251,9516]])
      assert([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz]) => map.canTravel(2,x,z,dx,dz,1,0,CollisionType.NORMAL)), `${x},${z} has a walkable exit`);
    assert.equal(types.Component.get(hud).id, 3279);
    const p = fixture(), enclosed = chamberTiles();
    console.log(`Packed sealed chamber (${enclosed.length} tiles): ${JSON.stringify(enclosed)}`);
    assert.equal(enclosed.length,24, 'all packed walkable chamber tiles were inspected');
    for (const [x,z] of enclosed)
      assert.equal(result('[proc,tog_inside]',p,[CoordGrid.packCoord(2,x,z)]),1, `sealed tile ${x},${z} stays inside`);
    for (const x of [3253,3254]) assert(enclosed.some(([tx,tz]) => tx === x && tz === 9517));
    assert(!enclosed.some(([x,z]) => x === 3251 && z === 9516), 'Juna side is not connected on foot');
    assert.equal(result('[proc,tog_inside]',p,[CoordGrid.packCoord(2,3251,9516)]),0);
    finish(p);
  });
  test('real completed Juna story opens HUD only on session admission', () => {
    const p = fixture(); startDialogue('[oploc1,hidey_unbuilt_bush_easy]', p);
    assert.equal(p.overlay, -1); assert(dialoguePage(p).join(' ').includes('Tell me... a story...'));
    resumeDialogue(p); resumeDialogue(p, 1); resumeDialogue(p); assert.equal(p.overlay, -1);
    resumeDialogue(p); assert.equal(p.overlay, hud); assert.deepEqual(tile(p), [2,3256,9517]);
    assert.equal(get(p,'tog_minigame_7_11'),10); assert.equal(count(p,'tog_bowl',worn),1);
    assert.equal(p.timers.get(timer.id).type, PlayerTimerType.NORMAL);
    assert.equal(p.getVar(vp('tog_last_visit_minute')),minute);
    ticks(p, 5); assert(get(p,'tog_minigame_7_11') < 10); finish(p);
  });
  test('entry gates revalidate quest, cooldown and hands without item loss', () => {
    const p = fixture(); set(p,'tog_juna_bowl',1); execute('[proc,tog_session_enter]',p);
    assert.equal(get(p,'tog_minigame_collecting'),0); assert.equal(p.overlay,-1);
    set(p,'tog_juna_bowl',2); p.invSet(worn,obj('bronze_dagger'),1,3);
    execute('[proc,tog_session_enter]',p); assert.equal(get(p,'tog_minigame_collecting'),0);
    assert.equal(p.getVar(vp('tog_last_visit_minute')),0); assert.equal(count(p,'bronze_dagger',worn),1);
    finish(p);
  });
  test('blue +1, green -1, zero floor, dry wall and movement cancellation', () => {
    const p = fixture(); enter(p); freezeStreams(1,2); collect(p,0); ticks(p,3);
    assert.equal(get(p,'tog_tears_collected'),1); p.weakQueue.clear();
    collect(p,1); ticks(p,3); assert.equal(get(p,'tog_tears_collected'),0);
    ticks(p,3); assert.equal(get(p,'tog_tears_collected'),0); p.weakQueue.clear();
    collect(p,2); ticks(p,3); assert.equal(get(p,'tog_tears_collected'),0); p.weakQueue.clear();
    collect(p,0); p.x++; ticks(p,3); assert.equal(get(p,'tog_tears_collected'),0);
    finish(p);
  });
  test('world streams move, retain three blue/three green, match original decoration and share ownership', () => {
    const p = fixture(); JavaRandom.setSeed(377); execute('[proc,tog_stream_update]',p);
    const before = [mask('tog_stream_blue_mask'),mask('tog_stream_green_mask')];
    const bits = n => n.toString(2).replaceAll('0','').length;
    assert.equal(bits(before[0]),3); assert.equal(bits(before[1]),3); assert.equal(before[0]&before[1],0);
    const q = fixture(); World.vars[shared('tog_stream_next_tick')] = World.currentTick+10;
    execute('[proc,tog_stream_update]',q); assert.deepEqual([mask('tog_stream_blue_mask'),mask('tog_stream_green_mask')],before);
    World.currentTick += 10; execute('[proc,tog_stream_update]',p);
    const after = [mask('tog_stream_blue_mask'),mask('tog_stream_green_mask')]; assert.notDeepEqual(after,before);
    for (let i=0;i<9;i++) {
      const side = [1,2,5,7].includes(i)?'l':'r';
      const colour = after[0]&(1<<i)?'good':after[1]&(1<<i)?'bad':'off';
      assert(World.getLoc(walls[i][0],walls[i][1],2,id('LocType',`tog_weeping_wall_${colour}_${side}`)), 'painted stream agrees with collected colour');
      assert(World.getLoc(walls[i][0],walls[i][1],2,id('LocType','tog_weepingwall')), 'original Collect-from wall retained');
    }
    finish(q); finish(p);
  });
  test('complete controlled-clock session rewards Farming once, resets bits/items/HUD and locks week', () => {
    const p=fixture(); enter(p); const before=p.stats[PlayerStat.FARMING];
    set(p,'tog_tears_collected',4); const remaining=p.timers.get(timer.id).args[0]-World.currentTick;
    ticks(p,remaining+3); assert.equal(p.stats[PlayerStat.FARMING]-before,4*60*10);
    assert.equal(get(p,'tog_juna_bowl'),2); assert.equal(get(p,'tog_minigame_collecting'),0);
    assert.equal(get(p,'tog_minigame_7_11'),0); assert.equal(get(p,'tog_tears_collected'),0);
    assert.equal(p.overlay,-1); assert.equal(count(p,'tog_bowl',worn)+count(p,'tog_bowl'),0);
    assert.deepEqual(tile(p),[2,3251,9516]); assert(!p.timers.has(timer.id));
    execute('[proc,tog_session_finish]',p,[1,1]); assert.equal(p.stats[PlayerStat.FARMING]-before,2400);
    assert.equal(result('[proc,tog_eligible]',p),0); finish(p);
  });
  test('engine-limit lowest-base deterministic ties and all 21 original enabled skills', () => {
    const p=fixture();
    for (const skill of Object.values(PlayerStat).filter(Number.isInteger)) {
      if (skill<0 || skill>20) continue;
      p.baseLevels.fill(50); p.levels.fill(99); p.baseLevels[skill]=30;
      assert.equal(result('[proc,tog_lowest_skill]',p),skill,`original skill ${skill}`);
    }
    p.baseLevels.fill(1); assert.equal(result('[proc,tog_lowest_skill]',p),PlayerStat.ATTACK);
    assert.equal(result('[proc,tog_xp_per_tear]',p,[30]),600);
    assert.equal(result('[proc,tog_xp_per_tear]',p,[99]),600);
    for (let level = 1; level < 30; level++) {
      const baseXp = level === 1 ? 0 : getExpByLevel(level) / 10;
      assert.equal(result('[proc,tog_xp_per_tear]',p,[level]),100+Math.floor(baseXp/27));
    }
    assert(result('[proc,tog_xp_per_tear]',p,[1])>0);
    finish(p);
  });
  test('seven-day AND progress gates and maxed-total favourable fallback', () => {
    const p=fixture(); enter(p); execute('[proc,tog_session_finish]',p,[0,1]);
    const total=p.getVar(vp('tog_last_total_level')); const when=p.getVar(vp('tog_last_visit_minute'));
    p.setVar(vp('qp'),44); minute=when+10079; assert.equal(result('[proc,tog_eligible]',p),0);
    minute++; assert.equal(result('[proc,tog_eligible]',p),1);
    p.setVar(vp('qp'),43); assert.equal(result('[proc,tog_eligible]',p),0);
    p.baseLevels[PlayerStat.ATTACK]++; assert.equal(result('[proc,tog_eligible]',p),1);
    assert.equal(p.getVar(vp('tog_last_total_level')),total);
    p.baseLevels.fill(99); p.setVar(vp('tog_last_total_level'),2079);
    assert.equal(result('[proc,tog_eligible]',p),1); finish(p);
  });
  test('native walks to both sealed corridor tiles retain the session and timed finish reaches Juna', () => {
    for (const x of [3254,3253]) {
      const p = fixture(); enter(p);
      assert(walk(p,x,9517).every(value => value === 1), 'every movement tick remains in-session');
      ticks(p,2); assert.equal(get(p,'tog_minigame_collecting'),1);
      assert.equal(p.overlay,hud); assert.equal(count(p,'tog_bowl',worn),1);
      ticks(p,p.timers.get(timer.id).args[0]-World.currentTick+3);
      assert.deepEqual(tile(p),[2,3251,9516]); assert.equal(get(p,'tog_minigame_collecting'),0);
      assert.equal(p.overlay,-1); assert.equal(count(p,'tog_bowl',worn)+count(p,'tog_bowl'),0);
      walk(p,3251,9517);
      const juna = World.getLoc(3252,9516,2,id('LocType','hidey_unbuilt_bush_easy')); assert(juna);
      assert(locHandler.handle(new OpLoc(1,juna.x,juna.z,juna.type),p));
      p.processInteraction();
      assert(p.messages.some(message => message.includes('wait seven days')), 'the real Juna handler is reachable after return');
      finish(p);
    }
  });
  for (const active of [true,false]) test(`real login evacuates the sealed corridor with session ${active ? 'active' : 'bits already clear'}`, () => {
    const p = fixture(); enter(p);
    assert(walk(p,3253,9517).every(value => value === 1));
    if (active) set(p,'tog_tears_collected',7);
    else for (const name of ['tog_minigame_collecting','tog_minigame_7_11','tog_tears_collected']) set(p,name,0);
    const before = p.stats.slice(), when = p.getVar(vp('tog_last_visit_minute'));
    const total = p.getVar(vp('tog_last_total_level')), qp = get(p,'tog_qp_before_return');
    p.timers.clear(); p.weakQueue.clear();
    execute('[login,_]',p); ticks(p,2);
    assert(p.messages.includes('Welcome to RuneScape.'), 'the real compiled login trigger ran');
    assert.deepEqual(tile(p),[2,3251,9516]); assert.deepEqual(p.stats,before);
    assert.equal(p.overlay,-1); assert.equal(count(p,'tog_bowl',worn)+count(p,'tog_bowl'),0);
    for (const name of ['tog_minigame_collecting','tog_minigame_7_11','tog_tears_collected']) assert.equal(get(p,name),0);
    assert.equal(get(p,'tog_juna_bowl'),2); assert.equal(get(p,'tog_qp_before_return'),qp);
    assert.equal(p.getVar(vp('tog_last_visit_minute')),when); assert.equal(p.getVar(vp('tog_last_total_level')),total);
    walk(p,3251,9517);
    finish(p);
  });
  test('logout/login clears only session state and bowl, evacuates, cannot replay rewards', () => {
    const p=fixture(); enter(p); set(p,'tog_tears_collected',7);
    const before=p.stats.slice(), when=p.getVar(vp('tog_last_visit_minute'));
    p.timers.clear(); p.weakQueue.clear(); execute('[proc,tog_login]',p);
    assert.deepEqual(p.stats,before); assert.deepEqual(tile(p),[2,3251,9516]);
    assert.equal(p.overlay,-1); assert.equal(get(p,'tog_minigame_collecting'),0);
    assert.equal(get(p,'tog_tears_collected'),0); assert.equal(get(p,'tog_minigame_7_11'),0);
    assert.equal(get(p,'tog_juna_bowl'),2); assert.equal(get(p,'tog_qp_before_return'),43);
    assert.equal(p.getVar(vp('tog_last_visit_minute')),when); assert.equal(count(p,'tog_bowl',worn),0);
    execute('[proc,tog_session_finish]',p,[1,1]); assert.deepEqual(p.stats,before); finish(p);
  });
  test('early teleport settles once, preserves destination and removes session ownership', () => {
    const p=fixture(); enter(p); set(p,'tog_tears_collected',1);
    p.level=0; p.x=3222; p.z=3218; const before=p.stats[PlayerStat.FARMING]; ticks(p,1);
    assert.deepEqual(tile(p),[0,3222,3218]); assert.equal(p.stats[PlayerStat.FARMING]-before,600);
    assert.equal(get(p,'tog_minigame_collecting'),0); assert.equal(p.overlay,-1);
    ticks(p,50); assert.equal(p.stats[PlayerStat.FARMING]-before,600); finish(p);
  });
  test('removing the temporary bowl ends the visit without leaving a spare bowl', () => {
    const p=fixture(); enter(p); set(p,'tog_tears_collected',1);
    const before=p.stats[PlayerStat.FARMING];
    execute('[proc,unequip]',p,[3]); ticks(p,4);
    assert.equal(get(p,'tog_minigame_collecting'),0);
    assert.equal(count(p,'tog_bowl',worn)+count(p,'tog_bowl'),0);
    assert.deepEqual(tile(p),[2,3251,9516]); assert.equal(p.stats[PlayerStat.FARMING]-before,600);
    finish(p);
  });
  console.log(`Tears minigame: ${cases} passed; failed=0`);
} finally {
  ScriptRunner.HANDLERS[ScriptOpcode.DATE_MINUTES]=clockHandler;
}
// The packed-map worker pool otherwise keeps this synchronous test entry alive.
process.exit(process.exitCode ?? 0);
