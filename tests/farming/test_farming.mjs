/** Real compiled growth/care execution and Player.save/PlayerLoading.load.
 * Run from the sibling engine: node --import tsx ../content/tests/farming/test_farming.mjs
 * Only the clock input is controlled. All transitions, draws, packets and saves
 * use production implementations. This is not a historical-authenticity proof.
 */
import assert from 'node:assert/strict';
import { World, Runner, Scripts, ScriptOpcode, PlayerTimerType, PlayerStat, JavaRandom,
  types, id, inv, player, proc, add, count, use, click } from './runtime.mjs';

const clock = id('VarPlayerType', 'farming_growth_minute');
const bits = [0, 1].flatMap(word => [0, 8, 16, 24].map(start =>
  id('VarBitType', `farming_allotment_varp_${word + 1}_${start}_${start + 7}`)));
const growth = Scripts.getByName('[timer,farming_growth]');
assert(growth, 'shared compiled growth timer must exist (old code fails here)');
assert(!Scripts.getByName('[timer,farming_potato_grow]'), 'obsolete planting-reset timer is removed');
const patch = World.getLoc(3050, 3307, 0, id('LocType', 'farming_veg_patch_1'));
assert(patch, 'original cache allotment placement is required');
const timer = p => p.timers.get(growth.id);
const stage = (p, index = 0) => p.getVarBit(bits[index]);
const setStage = (p, value, index = 0) => p.setVarBit(bits[index], value);
let minute = 600;
const dateHandler = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
let cases = 0, failures = 0;
function test(name, action) {
  cases++;
  try { JavaRandom.setSeed(0); action(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
const steps = (last, now, period, offline = false) => proc(player(), 'farming_growth_steps', last, now, period, offline ? 1 : 0).popInt();
function fresh(at = 600) {
  minute = at;
  const p = player();
  proc(p, 'farming_login');
  return p;
}
function tick(p, at, elapsed = 500) {
  minute = at;
  World.currentTick += elapsed;
  p.processTimers(PlayerTimerType.NORMAL);
}
function seedForDraw(draw) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * 128) === draw) return seed;
  }
  assert.fail(`cannot find native random draw ${draw}`);
}
const draws = new Map([0, 9, 10, 19, 20, 127].map(draw => [draw, seedForDraw(draw)]));
function advance(value, n, draw = 127) {
  JavaRandom.setSeed(draws.get(draw));
  return proc(player(), 'farming_potato_advance', value, n).popInt();
}
try {
  test('clock is original permanent slot 500, server-only; all patch bytes are permanent', () => {
    assert.equal(clock, 500, 'original client varp slot, not generated config identity');
    assert.equal(types.VarPlayerType.get(clock).scope, types.VarPlayerType.SCOPE_PERM);
    assert.equal(types.VarPlayerType.get(clock).transmit, false);
    for (const bit of bits) assert.equal(types.VarPlayerType.get(types.VarBitType.get(bit).basevar).scope, types.VarPlayerType.SCOPE_PERM);
  });
  test('zero elapsed cycles never rewrite or retransmit patch words', () => {
    const p = fresh(605); setStage(p, 6);
    const writes = [], nativeSetVar = p.setVar;
    p.setVar = function (id, value) {
      writes.push(id);
      return nativeSetVar.call(this, id, value);
    };
    minute = 606; proc(p, 'farming_reconcile', 0);
    assert.deepEqual(writes, [clock], 'observer delegates every production write');
    assert.equal(stage(p), 6);
  });
  for (const period of [5, 10, 20, 40, 80, 160, 320]) {
    test(`${period}-minute family: online first tick in five-minute UTC window only`, () => {
      const boundary = period * 1000;
      assert.equal(steps(boundary - 1, boundary, period), 1);
      assert.equal(steps(boundary - 1, boundary + 4, period), 1);
      assert.equal(steps(boundary, boundary + 4, period), 0, 'no repeat in same window');
      assert.equal(steps(boundary - 1, boundary + 5, period), period === 5 ? 1 : 0);
      assert.equal(steps(boundary - period * 5, boundary, period), 1, 'online missed windows never replay');
      assert.equal(steps(boundary, boundary - 1, period), 0, 'clock rollback grants no advance');
      assert.equal(steps(0, boundary, period), 0, 'first deployment initializes normally');
    });
    test(`${period}-minute family: offline only complete windows after saved checkpoint`, () => {
      const boundary = period * 1000;
      assert.equal(steps(boundary - 1, boundary + 4, period, true), 0);
      assert.equal(steps(boundary - 1, boundary + 5, period, true), 1);
      assert.equal(steps(boundary + 1, boundary + 5, period, true), 0, 'logout in window consumes that window');
      assert.equal(steps(boundary - 1, boundary + period * 3 + 5, period, true), 4);
    });
  }
  test('real NORMAL timer waits 500 game ticks, keeps phase with no crops, and survives planting', () => {
    const p = fresh(605);
    assert.equal(timer(p).interval, 500);
    assert.equal(timer(p).type, PlayerTimerType.NORMAL);
    const arm = timer(p).clock;
    setStage(p, 6);
    tick(p, 610, 499); assert.equal(stage(p), 6);
    tick(p, 610, 1); assert.equal(stage(p), 7);
    assert.equal(timer(p).clock, arm + 500);
    tick(p, 615); assert.equal(stage(p), 7, 'inactivity half of allotment cycle');
    tick(p, 620); assert.equal(stage(p), 8);
  });
  test('login/logout/hop reset can miss a real growth window; later window resumes', () => {
    const p = fresh(605); setStage(p, 6);
    minute = 609; proc(p, 'farming_logout');
    assert.equal(timer(p), undefined);
    const loaded = player(p.save());
    minute = 612; proc(loaded, 'farming_login');
    assert.equal(stage(loaded), 6, 'open window is not completed offline');
    tick(loaded, 617); assert.equal(stage(loaded), 6, 'reset tick fell outside 610..615');
    tick(loaded, 622); assert.equal(stage(loaded), 7);
    assert.equal(loaded.getVar(clock), 622);
  });
  test('actual save/load catches completed offline windows once, restores timer and stops at mature', () => {
    const p = fresh(605); setStage(p, 6);
    minute = 609; proc(p, 'farming_logout');
    const saved = p.save();
    const loaded = player(saved);
    assert.equal(loaded.timers.size, 0, 'engine does not serialize timers');
    assert.equal(loaded.getVar(clock), 609);
    minute = 635; proc(loaded, 'farming_login');
    assert.equal(stage(loaded), 9, '610,620,630 windows completed offline');
    assert.equal(loaded.getVar(clock), 635);
    assert.equal(timer(loaded).interval, 500);
    proc(loaded, 'farming_reconcile', 1); assert.equal(stage(loaded), 9, 'same-minute idempotence');
    minute = 10000000; proc(loaded, 'farming_reconcile', 1);
    assert.equal(stage(loaded), 10, 'large absence has a bounded finite path');
  });
  test('NORMAL access stall loses expired window, rather than replaying elapsed online growth', () => {
    const p = fresh(605); setStage(p, 6); p.delayed = true;
    tick(p, 610); assert.equal(stage(p), 6);
    p.delayed = false; tick(p, 616, 1); assert.equal(stage(p), 6);
    tick(p, 621); assert.equal(stage(p), 7);
  });
  test('a second planting does not reset another allotment or its timer phase', () => {
    const p = fresh(605); setStage(p, 6, 1);
    for (const name of ['rake', 'dibber', 'spade']) add(p, name);
    add(p, 'potato_seed', 3); p.setLevel(PlayerStat.FARMING, 1);
    const arm = timer(p).clock;
    for (let i = 0; i < 3; i++) assert(use(p, 'rake', patch));
    assert.equal(stage(p), 3);
    minute = 609; assert(use(p, 'potato_seed', patch));
    assert.equal(stage(p), 6); assert.equal(stage(p, 1), 6);
    assert.equal(timer(p).clock, arm);
    tick(p, 610); assert.equal(stage(p), 7); assert.equal(stage(p, 1), 7);
    assert.equal(count(p, 'potato_seed'), 0);
    assert.equal(p.stats[PlayerStat.FARMING], 80);
  });
  test('seed immunity, mature immunity, disease stasis and next-cycle death use real compiled paths', () => {
    assert.equal(advance(6, 1, 0), 7);
    assert.equal(advance(70, 1, 0), 7, 'seed water consumed without a disease draw');
    for (const value of [7, 8, 9]) {
      assert.equal(advance(value, 1, 0), value + 128);
      assert.equal(advance(value + 128, 1), value + 192);
      assert.equal(advance(value + 192, 1000000), value + 192);
    }
    for (const value of [3, 10, 11, 12, 13, 69, 74, 134, 138, 198, 202, 255]) assert.equal(advance(value, 1000000, 0), value);
  });
  for (const draw of [9, 10, 19, 20, 127]) test(`native disease draw ${draw}/128 distinguishes UNKNOWN dry20 and wet10`, () => {
    assert.equal(advance(7, 1, draw), draw < 20 ? 135 : 8);
    assert.equal(advance(71, 1, draw), draw < 10 ? 135 : 8);
  });
  test('native watering consumes exact can dose once, persists, then expires after one cycle', () => {
    const p = fresh(605); setStage(p, 7); add(p, 'watering_can_8');
    assert(use(p, 'watering_can_8', patch));
    assert.equal(stage(p), 71); assert.equal(count(p, 'watering_can_7'), 1);
    assert(use(p, 'watering_can_7', patch));
    assert.equal(stage(p), 71); assert.equal(count(p, 'watering_can_7'), 1, 'repeated watering does not debit');
    const loaded = player(p.save()); assert.equal(stage(loaded), 71);
    tick(p, 610); assert.equal(stage(p), 8);
    assert.equal(count(p, 'watering_can_7'), 1);
  });
  test('native cure restores same stage, uses vial, does not grant growth or immunity', () => {
    const p = fresh(605); setStage(p, 136); add(p, 'plant_cure');
    assert(use(p, 'plant_cure', patch));
    assert.equal(stage(p), 8); assert.equal(count(p, 'plant_cure'), 0); assert.equal(count(p, 'vial_empty'), 1);
    assert.equal(advance(stage(p), 1, 0), 136, 'cured crops may become diseased again');
    const loaded = player(p.save()); assert.equal(stage(loaded), 8);
  });
  test('offline disease can kill; water protects only one offline cycle and care bytes survive saving', () => {
    const p = fresh(605); setStage(p, 135); setStage(p, 71, 1);
    minute = 609; proc(p, 'farming_logout');
    const loaded = player(p.save());
    assert.equal(stage(loaded), 135); assert.equal(stage(loaded, 1), 71);
    minute = 615; proc(loaded, 'farming_login');
    assert.equal(stage(loaded), 199); assert.equal(stage(loaded, 1), 8);
    const again = player(loaded.save()); assert.equal(stage(again), 199);
  });
  test('native spade clears dead crop without XP; same patch can be planted and harvested again', () => {
    const p = fresh(605); setStage(p, 199); add(p, 'spade'); add(p, 'dibber'); add(p, 'potato_seed', 3);
    p.setLevel(PlayerStat.FARMING, 1);
    assert(use(p, 'spade', patch)); assert.equal(stage(p), 3); assert.equal(p.stats[PlayerStat.FARMING], 0);
    assert(use(p, 'potato_seed', patch)); assert.equal(stage(p), 6);
    for (const at of [610, 620, 630, 640]) tick(p, at);
    assert.equal(stage(p), 10);
    for (let i = 0; i < 3; i++) assert(click(p, patch));
    assert.equal(stage(p), 3); assert.equal(count(p, 'potato'), 3);
    assert.equal(p.stats[PlayerStat.FARMING], 350);
  });
  test('all eight selector bytes advance independently; unsupported family and unrelated varps remain exact', () => {
    const p = fresh(605);
    const values = [6, 70, 135, 199, 13, 74, 198, 255];
    values.forEach((value, index) => setStage(p, value, index));
    const unrelated = id('VarPlayerType', 'option_music'); p.setVar(unrelated, 3);
    tick(p, 610);
    assert.deepEqual(bits.map(bit => p.getVarBit(bit)), [7, 7, 199, 199, 13, 74, 198, 255]);
    assert.equal(p.getVar(unrelated), 3);
    const saved = player(p.save()); assert.deepEqual(bits.map(bit => saved.getVarBit(bit)), [7, 7, 199, 199, 13, 74, 198, 255]);
  });
} finally {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = dateHandler;
}
console.log(`Farming compiled checks: ${cases - failures}/${cases} passed`);
process.exit(failures ? 1 : 0);
