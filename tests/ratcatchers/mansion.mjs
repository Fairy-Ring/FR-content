// Mansion slice: compiled client-visible handlers against native 377 NPC/loc rows and collision.
import assert from 'node:assert/strict';
import {
  World, Npc, EntityLifeCycle, BlockWalk, ServerTriggerType as T, types, map,
  nativeNpcRows, nativeLocRows, b, player, run, cat, target, interact, stage,
  count, add, drop, fill, makeSpace, escape, tile, bank, withRandom
} from './runtime.mjs';

const atStage = (p, value) => p.setVarBit(b('ratcatch_var'), value);
const talkJimmy = p => interact(p, jimmy, T.OPNPC1);
const exact = (rows, coord) => rows.find(row => row.coord === coord);
const local = (level, x, z) => [level, 44 * 64 + x, 79 * 64 + z];
const jimmy = target('npc', 'vc_jimmy_dazzler', rows => rows.find(row => row.mx === 40 && row.mz === 51));
const townLadder = target('loc', 'vc_ladder_down', rows => exact(rows, '0_40_51_1_56'));
const trellisBase = target('loc', 'vc_trellis_base', rows => exact(rows, '0_44_79_28_49'));
const trellisTop = target('loc', 'vc_blank_trellis_top_trigger', rows => exact(rows, '1_44_79_28_48'));
const mansionLadder = target('loc', 'ladder', rows => exact(rows, '0_44_79_46_36'));
const mansionLadderTop = target('loc', 'laddertop', rows => exact(rows, '1_44_79_46_36'));
const innerDoor = target('loc', 'vc_elfdoor', rows => exact(rows, '0_44_79_22_44'));
const exitDoor = target('loc', 'vc_elfdoor', rows => exact(rows, '0_44_79_19_37'));

// These six rows and candidate stands are independently read from native map m44_79.
// Floor and collision checks below prove each direct test setup is reachable in the built map.
const ratSpecs = [
  { name: 'vc_partyrat_multi5', coord: '0_44_79_41_35', index: 5, stand: local(0, 40, 35) },
  { name: 'vc_partyrat_multi6', coord: '0_44_79_47_30', index: 6, stand: local(0, 47, 31) },
  { name: 'vc_partyrat_multi4', coord: '0_44_79_47_45', index: 4, stand: local(0, 47, 44) },
  { name: 'vc_partyrat_multi1', coord: '1_44_79_16_42', index: 1, stand: local(1, 17, 42) },
  { name: 'vc_partyrat_multi3', coord: '1_44_79_42_31', index: 3, stand: local(1, 42, 32) },
  { name: 'vc_partyrat_multi2', coord: '1_44_79_45_37', index: 2, stand: local(1, 44, 37) }
].map(spec => {
  const row = exact(nativeNpcRows(spec.name), spec.coord);
  assert(row, `native map placement ${spec.name} ${spec.coord}`);
  const type = types.NpcType.get(row.id);
  escape(spec.stand, `${spec.name} stand`);
  const path = map.findPathToEntity(spec.stand[0], spec.stand[1], spec.stand[2], row.x, row.z, 1, type.size, type.size);
  assert.equal(path.length, 0, `${spec.name} is already adjacent and needs no approach walk`);
  assert(map.reachedEntity(spec.stand[0], spec.stand[1], spec.stand[2], row.x, row.z, type.size, type.size, 1),
    `${spec.name} stand reaches the real NPC`);
  return { ...spec, row };
});

function place(p, at, label) {
  [p.level, p.x, p.z] = at;
  escape(tile(p), label);
}

function useLoc(p, fixture, label) {
  place(p, fixture.stand, `${label} approach`);
  assert.equal(interact(p, fixture, T.OPLOC1), `[oploc1,${fixture.row.name}]`, `${label} uses its native loc action`);
  escape(tile(p), `${label} landing`);
}

function catchRat(p, spec, randomValue) {
  place(p, spec.stand, `${spec.name} approach`);
  const prey = new Npc(spec.row.level, spec.row.x, spec.row.z, 1, 1, EntityLifeCycle.RESPAWN,
    World.getNextNid(), spec.row.id, BlockWalk.NONE);
  World.addNpc(prey, -1);
  const owned = cat(p);
  [owned.level, owned.x, owned.z] = spec.stand;
  return withRandom(randomValue, () => interact(p, { entity: owned, stand: spec.stand }, T.OPNPC5));
}

function caughtCount(p) {
  return [1, 2, 3, 4, 5, 6].reduce((sum, i) => sum + p.getVarBit(b(`vc_raton_off${i}`)), 0);
}

// Stage 3 is the preceding slice's input; Jimmy requires the real owned kitten/cat.
const p = player({ cat: 'kittenpet1' });
atStage(p, 3);
assert.equal(talkJimmy(p), '[opnpc1,vc_jimmy_dazzler]');
assert.equal(stage(p), 4, 'Jimmy starts the mansion stage');
assert.equal(count(p, 'ratcatchers_party_directions'), 1);
assert.equal(count(p, 'vc_rat_pole'), 1, 'lost pole is recovered at the mansion handoff');

drop(p, 'ratcatchers_party_directions');
drop(p, 'vc_rat_pole');
talkJimmy(p);
assert.equal(count(p, 'ratcatchers_party_directions'), 1, 'stage 4 restores missing directions');
assert.equal(count(p, 'vc_rat_pole'), 1, 'stage 4 restores a missing pole');

// A full pack does not advance without room for directions or duplicate a banked pole.
const full = player();
atStage(full, 3);
add(full, 'vc_rat_pole', 1, bank);
fill(full);
talkJimmy(full);
assert.equal(stage(full), 3, 'full inventory cannot lose the directions prerequisite');
assert.equal(count(full, 'ratcatchers_party_directions'), 0);
makeSpace(full);
talkJimmy(full);
assert.equal(stage(full), 4);
assert.equal(count(full, 'ratcatchers_party_directions'), 1);
assert.equal(count(full, 'vc_rat_pole'), 0);
assert.equal(count(full, 'vc_rat_pole', bank), 1, 'banked pole is not duplicated');

// Cat requirement and directions gate the native mansion ladder.
const noCat = player({ cat: null });
atStage(noCat, 3);
talkJimmy(noCat);
assert.equal(stage(noCat), 3, 'Jimmy refuses without the player-owned cat');
atStage(noCat, 4);
add(noCat, 'ratcatchers_party_directions');
place(noCat, townLadder.stand, 'no-cat ladder approach');
interact(noCat, townLadder, T.OPLOC1);
assert.equal(tile(noCat).join(), townLadder.stand.join(), 'ladder refuses without the owned cat');
escape(tile(noCat), 'town refusal landing');

drop(p, 'ratcatchers_party_directions');
place(p, townLadder.stand, 'missing-directions ladder approach');
interact(p, townLadder, T.OPLOC1);
assert.equal(tile(p).join(), townLadder.stand.join(), 'ladder refuses without directions');
talkJimmy(p);

// The production ladder, ordinary ladder pair, trellis pair and one ordinary mansion door.
useLoc(p, townLadder, 'mansion entrance');
assert.deepEqual(tile(p), [mansionLadder.row.level, mansionLadder.row.x - 1, mansionLadder.row.z], 'entry lands beside the native mansion ladder');
assert(nativeLocRows('ladder').some(row => row.coord === '0_44_79_46_36'), 'native mansion ladder is adjacent to entry');
useLoc(p, mansionLadder, 'mansion ladder up');
assert.equal(p.level, 1);
useLoc(p, mansionLadderTop, 'mansion ladder down');
assert.equal(p.level, 0);
useLoc(p, trellisBase, 'mansion trellis up');
assert.deepEqual(tile(p), [trellisTop.row.level, trellisTop.row.x, trellisTop.row.z], 'ascent lands on the native upper trigger');
useLoc(p, trellisTop, 'mansion trellis down');
assert.deepEqual(tile(p), [trellisBase.row.level, trellisBase.row.x, trellisBase.row.z], 'descent lands beside the native ground trellis');
useLoc(p, innerDoor, 'mansion interior door');
assert.equal(p.level, 0);
assert.equal(stage(p), 4, 'ordinary mansion door remains traversable during the task');

// The actual cat menu action handles misses, kitten chance, per-player rat bits and pole variants.
const byIndex = new Map(ratSpecs.map(spec => [spec.index, spec]));
const first = byIndex.get(5);
assert.equal(catchRat(p, first, 0.1), '[opnpc5,_petcat]');
assert.equal(caughtCount(p), 0, 'kitten miss changes no mansion progress');
assert.equal(count(p, 'vc_rat_pole'), 1, 'miss does not advance the pole');
assert.equal(catchRat(p, first, 0), '[opnpc5,_petcat]');
assert.equal(p.getVarBit(b('vc_raton_off5')), 1, `first real rat catch: ${p.messages.slice(-8).join(' | ')}`);
assert.equal(count(p, 'vc_rat_pole_1'), 1);

for (const index of [6, 4, 1, 3, 2]) {
  const spec = byIndex.get(index);
  assert.equal(catchRat(p, spec, 0), '[opnpc5,_petcat]', `${spec.name} is caught through the real cat action`);
  assert.equal(p.getVarBit(b(`vc_raton_off${index}`)), 1, `${spec.name} writes its own player bit`);
  assert.equal(count(p, `vc_rat_pole_${caughtCount(p)}`), 1, 'pole variant follows successful catch count');
}
assert.equal(caughtCount(p), 6);
assert.equal(stage(p), 5, 'six successful catches complete the mansion stage');

// Return through the native west door, then hand the six-rat result back to Jimmy.
useLoc(p, trellisTop, 'return to mansion ground floor');
useLoc(p, exitDoor, 'west mansion exit');
assert.deepEqual(tile(p), [townLadder.row.level, townLadder.row.x + 1, townLadder.row.z], 'exit returns beside Jimmy');
assert.equal(stage(p), 5);
drop(p, 'ratcatchers_party_directions');
drop(p, 'vc_rat_pole_6');
talkJimmy(p);
assert.equal(stage(p), 6, 'Jimmy advances the completed mansion handoff');
assert.equal(count(p, 'ratcatchers_party_directions'), 1, 'directions recover at handoff');
assert.equal(count(p, 'vc_rat_pole_6'), 1, 'pole remains at its final catch state');

// A separate player's progress is independent; guard reset points advance only from real catches.
const guardSpec = exact(nativeNpcRows('ratcatcher_guard_right_front'), '0_44_79_40_11');
assert(guardSpec, 'native mansion guard placement');
const guard = new Npc(guardSpec.level, guardSpec.x, guardSpec.z, 1, 1, EntityLifeCycle.RESPAWN,
  World.getNextNid(), guardSpec.id, BlockWalk.NONE);
World.addNpc(guard, -1);
const p2 = player();
atStage(p2, 3);
talkJimmy(p2);
assert.equal(stage(p2), 4);
useLoc(p2, townLadder, 'second player mansion entrance');

function primeGuard() {
  [guard.level, guard.x, guard.z] = [guardSpec.level, guardSpec.x, guardSpec.z];
  run(p2, '[ai_spawn,ratcatcher_guard_right_front]', [], guard);
}
function triggerGuard(label) {
  run(p2, '[proc,ratcatch_mansion_watch_start]');
  primeGuard();
  const front = local(0, 40, 12);
  place(p2, front, `${label} guard-front tile`);
  run(p2, '[walktrigger,ratcatch_mansion_guard_watch]');
  const reset = tile(p2);
  assert.notDeepEqual(reset, front, `${label} guard sight causes a checkpoint reset`);
  escape(reset, `${label} guard checkpoint`);
  return reset;
}

primeGuard();
const rear = local(0, 40, 8);
place(p2, rear, 'guard rear tile');
run(p2, '[walktrigger,ratcatch_mansion_guard_watch]');
assert.deepEqual(tile(p2), rear, 'guard facing north does not see behind itself');
primeGuard();
const observer = player({ cat: null });
atStage(observer, 4);
const observerTile = local(0, 40, 12);
place(observer, observerTile, 'unwatched second player');
const early = triggerGuard('zero catches');
assert.deepEqual(early, [mansionLadder.row.level, mansionLadder.row.x - 1, mansionLadder.row.z], 'early checkpoint is beside the native entrance ladder');
assert.notDeepEqual(early, observerTile);
assert.deepEqual(tile(observer), observerTile, "one player's guard reset cannot move another player");

for (const index of [5, 6]) assert.equal(catchRat(p2, byIndex.get(index), 0), '[opnpc5,_petcat]');
assert.equal(caughtCount(p2), 2);
assert.equal(p.getVarBit(b('vc_raton_off5')), 1, 'first player progress persists');
assert.equal(p2.getVarBit(b('vc_raton_off5')), 1, 'second player catches its own rat');
const middle = triggerGuard('two catches');
assert.deepEqual(middle, byIndex.get(1).stand, 'middle checkpoint is beside the native upper-west-room rat');
assert.notDeepEqual(middle, early, 'two catches select the middle checkpoint');

for (const index of [4, 1]) assert.equal(catchRat(p2, byIndex.get(index), 0), '[opnpc5,_petcat]');
assert.equal(caughtCount(p2), 4);
const late = triggerGuard('four catches');
assert.deepEqual(late, byIndex.get(3).stand, 'late checkpoint is beside the native upper-east-room rat');
assert.notDeepEqual(late, middle, 'four catches select the late checkpoint');
assert.equal(stage(p2), 4, 'guard recovery preserves mansion progress');

console.log('Rat Catchers mansion: Jimmy handoff, native travel, six rat catches, pole/directions recovery and per-player guard checkpoints passed');
process.exit(0);
