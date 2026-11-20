/** Compiled legacy stream proof. This preserves a period-accurate fault.
 * Run from the sibling engine: node --import tsx ../content/tests/farming/test_clock_m.mjs
 * Only fixture clock, RNG and own player state are controlled. No recorded traces.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, Scripts, ScriptOpcode, PlayerTimerType, JavaRandom,
  types, id, player, proc, run, click, load } from './runtime.mjs';

const clock = id('VarPlayerType', 'farming_growth_minute');
const timer = Scripts.getByName('[softtimer,farming_growth]');
assert(timer, 'selected SOFT growth trigger must be compiled');
assert(!Scripts.getByName('[timer,farming_growth]'), 'obsolete NORMAL trigger must be removed');
const names = ['farming_allotment_varp_1', 'farming_flower_varp', 'varp515_bits', 'farming_hops_varp', 'varp511_bits'];
const words = names.map(name => id('VarPlayerType', name));
const periods = [10, 5, 20, 10, 5];
const base = [6, 8, 4, 4, 64];
const mature = [10, 12, 8, 8, 91];
const bytes = p => words.map(word => p.getVar(word) & 255);
const seed = p => words.forEach((word, index) => p.setVar(word, base[index]));
let minute = 0;
const nativeDate = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
const at = tick => { World.currentTick = tick; minute = Math.floor(tick / 100); };
const queryPlayer = player();
const steps = (last, now, period, offline) => proc(queryPlayer, 'farming_growth_steps', last, now, period, Number(offline)).popInt();
const healthySeed = (() => {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Array.from({ length: 16 }, () => Math.floor(JavaRandom.nextDouble() * 128)).every(draw => draw >= 20)) return seed;
  }
  assert.fail('native sixteen-draw healthy witness');
})();
let cases = 0;
function test(name, action) { action(); cases++; console.log(`PASS ${name}`); }
class Rig {
  constructor(checkpoint = 995, reset = true) {
    this.p = player(); this.p.setVar(clock, checkpoint); seed(this.p);
    this.reset = reset; this.total = base.map(() => 0); this.fires = 0;
  }
  note() {
    const counts = bytes(this.p).map((value, i) => i === 4 && value >= 91 ? 9 : value - base[i]);
    this.total = this.total.map((value, i) => value + counts[i]);
    if (this.reset) seed(this.p);
    return counts;
  }
  login(tick) { at(tick); JavaRandom.setSeed(healthySeed); this.p.onLogin(); this.note(); }
  fire(tick) {
    at(tick); const before = this.p.timers.get(timer.id).clock;
    JavaRandom.setSeed(healthySeed); this.p.processTimers(PlayerTimerType.SOFT);
    if (before !== this.p.timers.get(timer.id).clock) { this.fires++; return this.note(); }
    return base.map(() => 0);
  }
  logout(tick) { at(tick); run(this.p, '[logout,_]'); }
  dispose() { delete World.players[this.p.pid]; }
}
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gameMap = await load('engine/GameMap.ts');
function binFixture(p) {
  for (const file of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort()) {
    const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file).map(Number);
    let section;
    for (const line of fs.readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
      if (section !== 'LOC') continue;
      const match = /^([0-3]) (\d+) (\d+): (\d+)(?: |$)/.exec(line);
      if (!match) continue;
      const [level, x, z, type] = match.slice(1).map(Number);
      if (types.LocType.get(type).debugname !== 'farming_compost_bin_1') continue;
      const bin = World.getLoc(mx * 64 + x, mz * 64 + z, level, type);
      assert(bin);
      const config = types.LocType.get(type);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (gameMap.isMapBlocked(bin.x + dx, bin.z + dz, level) ||
          !gameMap.reachedLoc(level, bin.x + dx, bin.z + dz, bin.x, bin.z,
            config.width, config.length, 1, bin.angle, bin.shape, config.forceapproach)) continue;
        p.x = bin.x + dx; p.z = bin.z + dz; p.level = level;
        return bin;
      }
    }
  }
  assert.fail('reachable original compost bin placement');
}

try {
  test('exactly eight writable parents are unprotected, read-only parents retain protection', () => {
    for (const name of [...names, 'farming_allotment_varp_2', 'farming_growth_minute', 'farming_soil_lives']) {
      assert.equal(types.VarPlayerType.get(id('VarPlayerType', name)).protect, false, name);
    }
    for (const name of ['varp513_bits', 'varp516_bits', 'farming_protection']) {
      assert.equal(types.VarPlayerType.get(id('VarPlayerType', name)).protect, true, name);
    }
    const slots = [504, 508, 515, 506, 511];
    assert.deepEqual(words, slots, 'original cache identities, not generated identities');
  });
  test('L=995 login 1002 retains the offline tick in the open window', () => {
    const rig = new Rig(); rig.login(100200); rig.fire(100700);
    assert.deepEqual(rig.total, [1, 2, 1, 1, 2], 'restoring N-5 must fail here'); rig.dispose();
  });
  test('same-minute inferred ticks are excluded, a later minute credits them', () => {
    for (const period of [5, 10, 20, 40, 80, 160, 320]) {
      const boundary = period * 100;
      assert.equal(steps(boundary - 5, boundary, period, true), 0);
      assert.equal(steps(boundary - 5, boundary + 1, period, true), 1);
      assert.equal(steps(boundary - 1, boundary + 4, period, true), 0);
      assert.equal(steps(boundary - 1, boundary + 5, period, true), 1);
      for (let phase = 0; phase < period; phase++) {
        const last = boundary + phase;
        assert(steps(last, last + period + 1, period, true) >= 1, `${period}/${phase}: P+1 break`);
      }
    }
  });
  test('short sessions and four-minute hopping preserve zero growth, then a longer stay advances', () => {
    // Period-accurate fault: restarted checks can miss every window. Do not repair it.
    for (const [on, off, count] of [[100, 400, 30], [390, 10, 45]]) {
      const rig = new Rig(1000);
      for (let k = 0; k < count; k++) {
        const start = 100000 + k * (on + off); rig.login(start); rig.logout(start + on);
      }
      assert.deepEqual(rig.total, [0, 0, 0, 0, 0]); assert.equal(rig.fires, 0);
      const start = 100000 + count * (on + off); rig.login(start);
      for (let elapsed = 500; elapsed <= 2500; elapsed += 500) rig.fire(start + elapsed);
      assert(rig.total.every(value => value > 0), 'a session longer than every P advances each family');
      rig.dispose();
    }
  });
  test('six hours offline matures crops and rots bins using the nominal stream', () => {
    const rig = new Rig(999, false); rig.logout(99900);
    const saved = rig.p.save(); rig.dispose(); rig.p = player(saved); rig.login(135900);
    assert.deepEqual(bytes(rig.p), mature);
    assert.deepEqual(periods.map(period => steps(999, 1359, period, true)), [36, 71, 18, 36, 71]);
    assert.equal(rig.p.getVar(clock), 1359); rig.dispose();
  });
  test('continuous free play has the published opportunity counts and checkpoint', () => {
    const rig = new Rig(1000); rig.login(100000);
    for (let tick = 100500; tick <= 115000; tick += 500) rig.fire(tick);
    assert.deepEqual(rig.total, [15, 30, 7, 15, 30]); assert.equal(rig.fires, 30);
    assert.equal(rig.p.getVar(clock), 1150); rig.dispose();
  });
  test('SOFT fires through a real main modal, delay and protection for sixty fixture minutes', () => {
    const results = [];
    for (const mode of ['free', 'modal', 'delay', 'protection', 'loggingOut']) {
      const rig = new Rig(); rig.login(99900); let held = 0;
      const nativeAll = World.playerLoop.all;
      World.playerLoop.all = () => [rig.p]; // Select the real player for the production World phase.
      try {
        for (let tick = 99901; tick <= 108000; tick++) {
          at(tick);
          if (tick === 100300) {
            if (mode === 'modal') rig.p.openMainModal(id('Component', 'inventory:inv'));
            if (mode === 'delay') { rig.p.delayed = true; rig.p.delayedUntil = 200000; }
            if (mode === 'protection') rig.p.protect = true;
            if (mode === 'loggingOut') rig.p.loggingOut = true;
          }
          if (tick === 106300) {
            if (mode === 'modal') rig.p.closeModal(false);
            rig.p.delayed = false; rig.p.protect = false; rig.p.loggingOut = false;
          }
          const before = rig.p.timers.get(timer.id).clock;
          JavaRandom.setSeed(healthySeed); World.processPlayers();
          if (before !== rig.p.timers.get(timer.id).clock) {
            rig.note(); rig.fires++;
            if (tick >= 100300 && tick < 106300) {
              held++;
              if (mode === 'modal') assert(rig.p.containsModalInterface(), 'growth leaves interface open');
              if (['modal', 'delay', 'protection'].includes(mode)) assert.equal(rig.p.canAccess(), false);
            }
          }
        }
      } finally { World.playerLoop.all = nativeAll; rig.dispose(); }
      if (mode === 'loggingOut') assert.equal(held, 0, 'actual World guard suppresses timers');
      else { assert.equal(held, 12); assert.deepEqual(rig.total, [8, 16, 4, 8, 16]); results.push(rig.total); }
    }
    assert(results.every(result => JSON.stringify(result) === JSON.stringify(results[0])));
  });
  test('reconnect retains the real timer and save without LOGOUT retains its checkpoint phase', () => {
    const rig = new Rig(); rig.login(99900);
    const originalTimer = rig.p.timers.get(timer.id); const checkpoint = rig.p.getVar(clock);
    at(100200); rig.p.onReconnect();
    assert.equal(rig.p.timers.get(timer.id), originalTimer); assert.equal(rig.p.getVar(clock), checkpoint);
    rig.fire(100400); assert.deepEqual(rig.total, [1, 1, 1, 1, 1]);
    at(100600); const saved = rig.p.save(); const last = rig.p.getVar(clock); rig.dispose();
    const loaded = player(saved); assert.equal(loaded.getVar(clock), last); assert.equal(loaded.timers.size, 0);
    at(101200); seed(loaded); proc(loaded, 'farming_login');
    assert.deepEqual(bytes(loaded), base.map((value, i) => value + steps(last, minute, periods[i], true)));
    delete World.players[loaded.pid];
  });
  test('disease before, on and after a slow boundary dies only at its later processed slow window', () => {
    let diseaseSeed;
    for (let candidate = 0; candidate < 200000; candidate++) {
      JavaRandom.setSeed(candidate);
      if (Math.floor(JavaRandom.nextDouble() * 128) === 0) { diseaseSeed = candidate; break; }
    }
    assert.notEqual(diseaseSeed, undefined, 'native disease RNG witness');
    for (const [index, tableName, period, slowPeriod] of [
      [0, 'farming_allotment', 10, 20], [1, 'farming_flower', 5, 10],
      [2, 'farming_herb', 20, 40], [3, 'farming_hops', 10, 20]
    ]) {
      const table = types.DbTableType.getByName(tableName);
      const crop = types.DbRowType.getInTable(table.id)[0];
      const field = name => crop.getValue(table.columnNames.indexOf(name), 0)[0];
      const first = field('first'), diseased = index === 2 ? field('diseased') : first + 129;
      const dead = index === 2 ? 170 : first + 193, boundary = 1280 + slowPeriod;
      for (const [label, entry] of [['before', boundary - period], ['on', boundary], ['after', boundary + 1]]) {
        const p = player();
        p.setVar(words[index], first + 1);
        p.setVar(clock, label === 'after' ? boundary - 1 : entry - 1);
        minute = entry; JavaRandom.setSeed(diseaseSeed); proc(p, 'farming_reconcile', 0);
        assert.equal(bytes(p)[index], diseased, `${tableName}/${label}: entry consumes one step`);
        minute = entry + 1; proc(p, 'farming_reconcile', 0);
        assert.equal(bytes(p)[index], diseased, 'same window cannot kill the newly diseased crop');
        minute = label === 'before' ? boundary : boundary + slowPeriod;
        proc(p, 'farming_reconcile', 0);
        assert.equal(bytes(p)[index], dead, `${tableName}/${label}: first later processed slow window`);
        delete World.players[p.pid];
      }
    }
  });
  test('offline arithmetic enumerates the restarted stream, online never batches or repeats a window', () => {
    let random = 377;
    const rnd = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
    for (let sample = 0; sample < 3000; sample++) {
      const last = 1000 + rnd(500), now = last + rnd(500), period = periods[rnd(5)];
      const windows = new Set();
      for (let tickMinute = last + 5; tickMinute < now; tickMinute += 5) {
        const window = Math.floor(tickMinute / period) * period;
        if (tickMinute % period < 5 && window > Math.floor(last / period) * period) windows.add(window);
      }
      assert.equal(steps(last, now, period, true), windows.size, `${last}/${now}/${period}`);
      const online = steps(last, now, period, false);
      assert(online === 0 || online === 1, 'one online reconcile cannot double-step a row');
      assert.equal(steps(now, now, period, false), 0, 'second reconcile in the same minute is inert');
      const published = Math.max(0, Math.floor((now - 5) / period) - Math.floor(last / period));
      assert(windows.size >= published, 'no published offline opportunity is removed');
    }
  });
  test('a native bin operation cannot grant a crop step or write the clock', () => {
    const rig = new Rig(); at(100510); rig.p.setVar(clock, 1002);
    const bin = binFixture(rig.p), before = bytes(rig.p), writes = [];
    const nativeSet = rig.p.setVar;
    rig.p.setVar = function (word, value) { writes.push(word); return nativeSet.call(this, word, value); };
    assert(click(rig.p, bin, 1), 'native closed-bin option accepted by packet handler');
    assert.deepEqual(bytes(rig.p), before, 'restoring the bin reconcile call must fail here');
    assert.equal(rig.p.getVar(clock), 1002); assert(!writes.includes(clock));
    assert.deepEqual(rig.p.messages, ['Nothing interesting happens.']); rig.dispose();
  });
} finally { Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = nativeDate; delete World.players[queryPlayer.pid]; }
console.log(`Farming legacy clock checks: ${cases}/${cases} passed`);
process.exit(0);
