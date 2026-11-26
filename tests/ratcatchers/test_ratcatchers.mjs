// Production compiled handlers, native placements and original collision. No server is started.
import assert from 'node:assert/strict';
import {
  World, Npc, EntityLifeCycle, BlockWalk, ScriptProvider, ServerTriggerType as T,
  types, map, nativeNpcRows, nativeLocRows, id, obj, inv, worn, bank, v, b,
  player, run, finish, button, held, useItems, cat, target, interact, stage,
  count, add, drop, fill, makeSpace, points, escape, tile, load, withRandom
} from './runtime.mjs';
const { PlayerStat } = await load('engine/entity/PlayerStat.ts');
const { default: ScriptRunner } = await load('engine/script/ScriptRunner.ts');
const { NpcMode } = await load('engine/entity/NpcMode.ts');
assert.equal((await load('util/Environment.ts')).default.NODE_XPRATE, 1);
const names = ['gertrude', 'vc_phingspet', 'vc_grimesquit', 'vc_smokin_joe', 'vc_face',
  'vc_felkrash_the_bard', 'feud_snakecharmer'];
const npcs = Object.fromEntries(names.map(name => [name, target('npc', name)]));
const talk = (p, name, choices = []) => interact(p, npcs[name], T.OPNPC1, null, choices);
const atStage = (p, value) => p.setVarBit(b('ratcatch_var'), value);
const bowl = target('loc', 'feud_money_bowl');
const hole = target('loc', 'ratcatchers_rathole5', rows => rows.find(r => r.x === 2933 && r.z === 10212));
const manhole = target('loc', 'vc_manhole_open', rows => rows.find(r => r.x === 3018 && r.z === 3232));
const ladder = target('loc', 'vc_ladder', rows => rows.find(r => r.x === 2962 && r.z === 9651 && r.level === 0));
const useLoc = (p, item, fixture, choices = []) => interact(p, fixture, T.OPLOCU, item, choices);

// Every moved original quest item is private; original state is persisted, not a new client config.
for (const name of ['ratcatchers_cat_antipoison', 'ratpits_manual', 'ratcatchers_poisonedcheese',
  'ratcatchers_music', 'ratcatchers_party_directions', 'ratcatchers_weedpot', 'ratcatchers_smokey_weedpot',
  'vc_rat_pole', ...Array.from({ length: 6 }, (_, n) => `vc_rat_pole_${n + 1}`)]) {
  assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} is private/untradeable`);
}
for (const name of ['main_ratcatch_var', 'ratcatch_var_multi', 'ratcatch_var_temp1', 'ratcatch_var_temp2']) {
  assert.equal(types.VarPlayerType.get(v(name)).scope, types.VarPlayerType.SCOPE_PERM, `${name} survives logout`);
}

// Tick the real native guards before entry; controlled patrol must not inherit wander drift.
{
  const guardNames = ['ratcatcher_staticguard', 'ratcatcher_chiefguard',
    'ratcatcher_guard_left_front', 'ratcatcher_guard_left_mid', 'ratcatcher_guard_left_back',
    'ratcatcher_guard_left_fullback', 'ratcatcher_guard_right_front', 'ratcatcher_guard_right_mid',
    'ratcatcher_guard_right_back', 'ratcatcher_guard_right_fullback',
    'ratcatcher_guard_left_inside', 'ratcatcher_guard_right_inside'];
  const origins = new Map(guardNames.map(name => {
    const rows = nativeNpcRows(name);
    assert.equal(rows.length, 1, `${name} has one original map placement`);
    return [rows[0].id, [rows[0].level, rows[0].x, rows[0].z]];
  }));
  const guards = [...World.npcs].filter(npc => origins.has(npc.type));
  assert.equal(guards.length, 12, 'all twelve guards are native world NPCs');
  const active = id('VarNpcType', 'npc_int2'), facing = id('VarNpcType', 'npc_int');
  const actor = player(), keeper = player({ cat: null });
  for (const p of [actor, keeper]) World.gameMap.getZone(p.x, p.z, p.level).enter(p);
  const place = (p, at) => {
    p.teleport(at[1], at[2], at[0]);
    assert.deepEqual(tile(p), at, 'fixture uses native teleport and zone membership');
  };
  const advance = (ticks, wander = false) => {
    const previous = Math.random;
    let draws = 0;
    if (wander) Math.random = () => { draws++; return 0; };
    try {
      for (let tick = 0; tick < ticks; tick++) {
        World.currentTick++;
        for (const guard of guards) {
          guard.resetEntity(false);
          guard.turn();
        }
      }
    } finally { Math.random = previous; }
    return draws;
  };
  const townLadder = target('loc', 'vc_ladder_down', rows => rows.find(row => row.coord === '0_40_51_1_56'));
  const ratStands = [[0, 2856, 5091], [0, 2863, 5087], [0, 2863, 5100],
    [1, 2833, 5098], [1, 2858, 5088], [1, 2860, 5093]];
  const checkpoints = [[0, 2861, 5092], [1, 2833, 5098], [1, 2858, 5088]];
  const outside = [0, 3150, 3412];
  atStage(actor, 4); add(actor, 'ratcatchers_party_directions');
  for (const ticks of [1, 7, 31, 137]) {
    for (const guard of guards) {
      assert.equal(types.NpcType.get(guard.type).defaultmode, NpcMode.WANDER, 'original wander config');
      assert(guard.timerInterval <= 0, 'no patrol timer before entry');
    }
    assert(advance(ticks, true) > 0, 'unoccupied guards consume their real wander RNG draws');
    assert(guards.some(guard => tile(guard).join() !== origins.get(guard.type).join()), 'pre-entry ticks really move guards');
    place(actor, townLadder.stand);
    assert.equal(interact(actor, townLadder, T.OPLOC1), '[oploc1,vc_ladder_down]');
    assert.deepEqual(tile(actor), checkpoints[0], 'native mansion entry starts the watch');
    for (const guard of guards) {
      assert.deepEqual(tile(guard), origins.get(guard.type), 'entry restores each original spawn anchor');
      assert.equal(guard.targetOp, NpcMode.NONE);
      assert.equal(guard.getVar(active), 1);
      assert.equal(guard.timerInterval, 4);
    }
    place(actor, [0, 2856, 5068]);
    assert.equal(run(actor, '[proc,ratcatch_mansion_guard_detected]').popInt(), 1, 'native guard sees its forward tile');
    run(actor, '[walktrigger,ratcatch_mansion_guard_watch]');
    assert.deepEqual(tile(actor), checkpoints[0], 'guard detection still resets to the safe checkpoint');
    const phases = new Set();
    for (let tick = 0; tick <= 12; tick++) {
      if (tick) advance(1);
      for (const stand of [...ratStands, ...checkpoints]) {
        place(actor, stand);
        assert.equal(run(actor, '[proc,ratcatch_mansion_guard_detected]').popInt(), 0,
          `pre-entry ${ticks}, patrol tick ${tick}: rat stand/checkpoint ${stand} is safe`);
      }
      for (const guard of guards) {
        phases.add(guard.getVar(facing));
        const origin = origins.get(guard.type);
        assert.equal(guard.level, origin[0]); assert.equal(guard.x, origin[1]);
        assert(guard.z === origin[2] || guard.z === origin[2] + 1, 'patrol stays on its two anchored tiles');
      }
    }
    assert.deepEqual([...phases].sort(), [0, 2], 'both north and south patrol phases were checked');
    place(keeper, checkpoints[1]);
    place(actor, outside);
    run(actor, '[walktrigger,ratcatch_mansion_guard_watch]');
    advance(4);
    for (const guard of guards) {
      assert.equal(guard.targetOp, NpcMode.NONE, 'an upper-floor player keeps both floors active');
      assert.equal(guard.timerInterval, 4);
    }
    place(keeper, outside);
    advance(4);
    for (const guard of guards) {
      assert.equal(guard.targetOp, NpcMode.WANDER, 'last departure restores original wander');
      assert.equal(guard.timerInterval, 0, 'empty mansion has no continuous patrol timers');
      assert.equal(guard.getVar(active), 0, 'next entry can reactivate the guard');
    }
  }
  for (const p of [actor, keeper]) World.gameMap.getZone(p.x, p.z, p.level).leave(p);
  console.log('Mansion guard regression: 12 native guards, pre-entry ticks 1/7/31/137, 468 safe stand/checkpoint checks, cone reset and two-plane lifecycle passed');
}
for (const options of [{ qualified: false }, { cat: null }, { cat: 'overgrowncat' }]) {
  const p = player(options); talk(p, 'gertrude', [1]); assert.equal(stage(p), 0, 'missing requirement refuses start');
}
{
  const p = player({ cat: null }); p.setVar(v('follower_obj'), obj('growncatobject'));
  talk(p, 'gertrude', [1]); assert.equal(stage(p), 0, 'follower metadata without a world cat is not enough');
}
{
  const p = player(); p.setVar(v('fluffs'), 0);
  assert.equal(run(p, '[proc,ratcatch_gertrude_hook]').popInt(), 0, 'Gertrude quest keeps priority');
  assert.equal(stage(p), 0);
}
for (const catType of ['kittenpet1', 'growncat']) {
  const p = player({ cat: catType }); talk(p, 'gertrude', [1]); assert.equal(stage(p), 1);
  talk(p, 'vc_phingspet'); assert.equal(stage(p), 2); assert.equal(p.getVarBit(b('ratcatch_ometer')), 0);
}
{
  const p = player(); talk(p, 'gertrude', [2]); assert.equal(stage(p), 0, 'opt-out retains ordinary Gertrude dialogue');
}
for (const value of [1, 2]) {
  const p = player(); atStage(p, value);
  assert.equal(run(p, '[proc,ratcatch_gertrude_hook]', [], null, [1]).popInt(), 1, 'sewer handoff reminder remains available');
  assert.equal(stage(p), value);
}
for (const value of [3, 10, 20, 127]) {
  const p = player(); atStage(p, value);
  assert.equal(run(p, '[proc,ratcatch_gertrude_hook]').popInt(), 0, 'Gertrude falls through after the sewer handoff');
  assert.equal(stage(p), value);
}
{
  const p = player({ cat: null }); add(p, 'coins', 100);
  talk(p, 'gertrude', [2, 1, 0]);
  assert.equal(count(p, 'coins'), 0, 'ordinary kitten purchase still charges exactly 100');
  assert.equal(cat(p).type, id('NpcType', 'kittenpet1'), 'the native picker gives the selected ordinary kitten follower');
  assert.equal(stage(p), 0);
}

// The shared Chase-vermin dispatch runs the real ordinary cat script and only successful sewer catches count.
const sewerRows = nativeNpcRows('rat').filter(r => r.level === 0 && r.x >= 3200 && r.x <= 3263 && r.z >= 9856 && r.z <= 9919);
assert(sewerRows.length, 'original sewers contain ordinary rats');
function chase(p, row, randomValue) {
  const prey = new Npc(row.level, row.x, row.z, 1, 1, EntityLifeCycle.RESPAWN,
    World.getNextNid(), row.id, BlockWalk.NONE);
  World.addNpc(prey, -1);
  const rat = target('npc', 'rat', () => row);
  const owned = cat(p); [owned.level, owned.x, owned.z] = rat.stand;
  return withRandom(randomValue, () => interact(p, { entity: owned, stand: rat.stand }, T.OPNPC5));
}
const p = player(); talk(p, 'gertrude', [1]); talk(p, 'vc_grimesquit');
assert.equal(stage(p), 2);
chase(p, sewerRows[0], 0.999999); assert.equal(p.getVarBit(b('ratcatch_ometer')), 0, 'failed catch earns nothing');
for (let n = 0; n < 8; n++) {
  assert.equal(chase(p, sewerRows[n % sewerRows.length], 0), '[opnpc5,_petcat]');
  assert.equal(p.getVarBit(b('ratcatch_ometer')), n + 1);
}
fill(p); talk(p, 'vc_phingspet'); assert.equal(stage(p), 2, 'full inventory does not lose the pole');
makeSpace(p); talk(p, 'vc_phingspet'); assert.equal(stage(p), 3); assert.equal(count(p, 'vc_rat_pole'), 1);
for (let value = 3; value <= 20; value++) {
  atStage(p, value); drop(p, 'vc_rat_pole'); talk(p, 'vc_grimesquit');
  assert.equal(count(p, 'vc_rat_pole'), 1, `pole recovery remains available at stage ${value}`);
}
for (const inventory of [bank, worn]) {
  drop(p, 'vc_rat_pole'); add(p, 'vc_rat_pole', 1, inventory); talk(p, 'vc_grimesquit');
  assert.equal(count(p, 'vc_rat_pole'), 0, 'stored or worn pole does not duplicate'); drop(p, 'vc_rat_pole', inventory);
}
{
  const q = player(); atStage(q, 2);
  const outside = nativeNpcRows('rat').find(r => r.level === 0 && r.z < 9000);
  assert(outside); chase(q, outside, 0);
  assert.equal(q.getVarBit(b('ratcatch_ometer')), 0, 'ordinary catch outside the sewers earns no quest credit');
  assert.equal((q.getVar(v('cat_growth')) >>> 20) & 127, 1, 'ordinary catch counter still increases');
  atStage(q, 10); chase(q, outside, 0);
  assert.equal((q.getVar(v('cat_growth')) >>> 20) & 127, 2, 'warehouse stage does not steal ordinary catches elsewhere');
}

// Both recipe orientations use the real item-use packet, retaining shared pot/tinderbox priorities.
for (const reverse of [false, true]) {
  const q = player(); add(q, 'weeds'); add(q, 'pot_empty'); add(q, 'tinderbox');
  useItems(q, ...(reverse ? ['pot_empty', 'weeds'] : ['weeds', 'pot_empty']));
  assert.equal(count(q, 'ratcatchers_weedpot'), 1); assert.equal(count(q, 'weeds'), 0); assert.equal(count(q, 'pot_empty'), 0);
  useItems(q, ...(reverse ? ['tinderbox', 'ratcatchers_weedpot'] : ['ratcatchers_weedpot', 'tinderbox']));
  assert.equal(count(q, 'ratcatchers_smokey_weedpot'), 1); assert.equal(count(q, 'tinderbox'), 1);
}
{
  const q = player(); q.setVar(v('onesmallfavour'), 35); add(q, 'potlid'); add(q, 'pot_empty');
  useItems(q, 'potlid', 'pot_empty'); assert.equal(count(q, 'favour_airtight_pot'), 1);
  assert.equal(count(q, 'ratcatchers_weedpot'), 0, 'OSF recipe is not pre-empted');
}
// Observe the actual native handler at its first delay, before the real scene rat exits its hole.
function smoke(p, fixture, expectedHole, expectedExit) {
  p.closeModal(); [p.level, p.x, p.z] = fixture.stand; p.originX = p.x; p.originZ = p.z;
  p.target = fixture.entity; p.targetOp = T.OPLOCU - 7; p.lastUseItem = obj('ratcatchers_smokey_weedpot');
  const script = p.getOpTrigger(); assert.equal(script?.name, '[oplocu,ratcatchers_rathole5]');
  const state = ScriptRunner.init(script, p, fixture.entity);
  p.executeScript(state, true, true);
  assert.deepEqual(tile(state.activeNpc), expectedHole, 'a real rat emerges from the opposite native hole');
  escape(tile(state.activeNpc), 'Joe scene actor spawn'); escape(expectedExit, 'Joe scene actor exit');
  const route = map.findPath(...expectedHole, expectedExit[1], expectedExit[2]);
  assert.equal(route.length, 1, 'the scene rat has an unobstructed one-step exit and retreat');
  assert.equal(route.at(-1), (expectedExit[1] << 14) | expectedExit[2]);
  finish(p, state);
  if (stage(p) === 14) assert.deepEqual(tile(cat(p)), expectedExit, 'the owned cat guards the real opposite exit');
}
atStage(p, 12); add(p, 'ratcatchers_smokey_weedpot'); talk(p, 'vc_smokin_joe');
smoke(p, hole, [0, 2932, 10207], [0, 2932, 10206]); assert.equal(stage(p), 13, 'first smoke lets rats escape and retreat');
smoke(p, hole, [0, 2932, 10207], [0, 2932, 10206]); assert.equal(stage(p), 14, 'cat blocks the other hole on the second attempt');
{
  const other = player(), south = target('loc', 'ratcatchers_rathole5', rows => rows.find(r => r.x === 2932 && r.z === 10207));
  atStage(other, 12); add(other, 'ratcatchers_smokey_weedpot');
  smoke(other, south, [0, 2933, 10212], [0, 2933, 10213]); assert.equal(stage(other), 13);
  smoke(other, south, [0, 2933, 10212], [0, 2933, 10213]); assert.equal(stage(other), 14);
}
assert.equal(p.getVarBit(b('ratcatch_catknowsdrill')), 1);
talk(p, 'vc_smokin_joe'); assert.equal(stage(p), 15);
{
  const q = player({ cat: null }); atStage(q, 13); add(q, 'ratcatchers_smokey_weedpot');
  useLoc(q, 'ratcatchers_smokey_weedpot', hole); assert.equal(stage(q), 13, 'second smoke really requires a follower');
}

// Native Sarim entry and exit, with destinations derived independently from original counterpart placements.
talk(p, 'vc_face'); assert.equal(stage(p), 16);
interact(p, manhole, T.OPLOC1); assert.deepEqual(tile(p), [0, 2962, 9650]); escape(tile(p), 'Sarim pit entry');
assert(nativeLocRows('vc_ladder').some(r => r.level === p.level && r.x === p.x && r.z === p.z + 1));
talk(p, 'vc_felkrash_the_bard'); assert.equal(stage(p), 17);
interact(p, ladder, T.OPLOC1); assert.deepEqual(tile(p), [0, 3018, 3231]); escape(tile(p), 'Sarim pit exit');
assert.equal(p.z + 1, manhole.row.z); assert.equal(p.x, manhole.row.x);
talk(p, 'vc_face'); assert.equal(stage(p), 18);

// The Feud kit remains available at any Rat Catchers stage through its explicit opt-out.
{
  const q = player(); atStage(q, 18); add(q, 'coins', 1);
  useLoc(q, 'coins', bowl, [2]); assert.equal(stage(q), 18);
  assert.equal(count(q, 'snake_flute'), 1); assert.equal(count(q, 'basket_for_snake'), 1);
  assert.equal(count(q, 'coins'), 0, 'Feud bowl still charges one coin');
}
{
  const q = player(); atStage(q, 18); add(q, 'coins', 2000); fill(q);
  useLoc(q, 'coins', bowl, [1, 1]);
  assert.equal(stage(q), 18); assert.equal(count(q, 'coins'), 1999, 'capacity refusal only spends the existing attention coin');
}
add(p, 'coins', 51); add(p, 'ring_of_charos_unlocked', 1, worn);
useLoc(p, 'coins', bowl, [1, 2, 1]); assert.equal(stage(p), 19);
assert.equal(count(p, 'coins'), 0, 'period Charos price is 50 after the attention coin');
assert.equal(count(p, 'ratcatchers_music'), 1); assert.equal(count(p, 'snake_flute'), 1);
for (const value of [19, 20]) {
  atStage(p, value); drop(p, 'ratcatchers_music'); drop(p, 'snake_flute');
  talk(p, 'feud_snakecharmer'); assert.equal(count(p, 'ratcatchers_music'), 1); assert.equal(count(p, 'snake_flute'), 1);
}
atStage(p, 19); held(p, 'ratcatchers_music'); p.closeModal();
held(p, 'snake_flute'); assert.equal(p.modalMain, id('Component', 'inter_322'));
button(p, 'inter_322:com_23'); assert.equal(p.getVarBit(b('vc_note_number')), 0, 'previous is bounded');
button(p, 'inter_322:com_21'); assert.equal(stage(p), 19, 'wrong location cannot complete');
[p.level, p.x, p.z] = [0, 3018, 3231];
button(p, 'inter_322:com_21'); assert.equal(stage(p), 19, 'blank tune cannot complete');
for (let page = 0; page < 8; page++) {
  button(p, `inter_322:com_${page < 7 ? 13 + page : 13}`);
  if (page === 7) button(p, 'inter_322:com_12');
  assert.equal(p.getVarBit(b(`vc_note${page + 1}`)), [63, 62, 60, 56, 48, 32, 1, 127][page]);
  button(p, 'inter_322:com_22');
}
assert.equal(p.getVarBit(b('vc_note_number')), 7, 'next is bounded at eight pages');
button(p, 'inter_322:com_21'); assert.equal(stage(p), 20, 'actual component sequence solves the eight-note puzzle');
const qp = points(p), xp = p.stats[PlayerStat.THIEVING]; p.setVar(v('qp'), qp);
talk(p, 'vc_felkrash_the_bard'); assert.equal(stage(p), 127);
assert.equal(points(p) - qp, 2); assert.equal(p.stats[PlayerStat.THIEVING] - xp, 45000);
assert.equal(p.modalMain, id('Component', 'questscroll_death'), 'real completion scroll is open');
assert.equal(count(p, 'felinemedal'), 0, 'there is no invented medal reward');
p.closeModal(); talk(p, 'vc_felkrash_the_bard', [2]);
assert.equal(points(p) - qp, 2); assert.equal(p.stats[PlayerStat.THIEVING] - xp, 45000, 'repeated hand-in cannot repay XP');
assert.equal(run(p, '[proc,ratcatch_joe_hook]').popInt(), 0, 'completed players bypass Joe’s quest referral');
const joePackets = p.packets.length;
talk(p, 'vc_smokin_joe');
assert(p.packets.slice(joePackets).some(packet => packet.text?.includes('Despite your wild articulations and gesticulations')),
  'post-completion Talk-to executes Joe’s ordinary dialogue');
assert.equal(stage(p), 127);
for (const value of [0, 7, 127]) {
  const cook = player({ cat: null }); atStage(cook, value);
  add(cook, 'cheese'); add(cook, 'rat_poison'); add(cook, 'pizza_base');
  useItems(cook, 'pizza_base', 'cheese');
  assert(cook.messages.some(message => message.includes('add the tomato first')), 'ordinary cheese-on-base still takes its cooking branch');
  assert.equal(count(cook, 'cheese'), 1); assert.equal(count(cook, 'pizza_base'), 1);
  drop(cook, 'pizza_base'); add(cook, 'incomplete_pizza');
  useItems(cook, 'incomplete_pizza', 'cheese');
  assert.equal(count(cook, 'uncooked_pizza'), 1, 'ordinary cheese makes pizza even with Rat Catchers poison in inventory');
  assert.equal(count(cook, 'cheese'), 0); assert.equal(count(cook, 'incomplete_pizza'), 0);
  assert.equal(count(cook, 'rat_poison'), 1); assert.equal(stage(cook), value);
}
console.log('Rat Catchers: prerequisites, real sewer catches, recipes, smoke, Sarim travel, flute, recovery, shared cooking and once-only rewards passed');
process.exit(0);
