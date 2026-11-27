import { assert, check, player, run, give, count, reconnect, v, id, types, inv, coord, tile, origin, results, PlayerStat } from './runtime.mjs';
const selected = process.env.ARENA1_FAMILY;
for (const family of ['arnav-lost-found', 'drill-forester', 'bob-leo']) {
  if (!selected || selected === family) (await import(`./${family}.mjs`)).default();
}
if (!selected) {
  for (const [event, start, args = []] of [[16, 'macro_drill_start'], [17, 'macro_bob_start', [PlayerStat.FISHING]], [18, 'macro_forester_start'], [19, 'macro_leo_start']]) {
    check(`arena ${event} native relog keeps origin/task and outside login safely releases`, () => {
      let p = player(); give(p, 'bronze_dagger');
      run(p, `[proc,${start}]`, args);
      assert.equal(p.getVar(v('macro_event')), event);
      const vars = ['macro_event', 'macro_event_origin_coord', 'macro_event_target_coord', 'macro_transmit', 'macro_digger_var', 'macro_digger_var_2'];
      const before = vars.map(name => p.getVar(v(name)));
      p = reconnect(p);
      assert.deepEqual(vars.map(name => p.getVar(v(name))), before);
      assert.equal(p.getVar(v('macro_event_origin_coord')), coord(...origin));
      assert.equal(count(p, 'bronze_dagger'), 1);
      run(p, '[proc,p_telejump_safe]', [coord(...origin)]);
      // A new native login is also a recovery boundary for any missed zone exit.
      run(p, '[queue,macro_event_login]');
      assert.deepEqual(tile(p), origin);
      assert.equal(p.getVar(v('macro_event')), 0);
      assert.equal(count(p, 'coins'), 0);
      assert.equal(count(p, 'bronze_dagger'), 1);
      assert.equal(p.tabs[3], id(types.Component, 'inventory'), 'ordinary inventory tab is restored');
    });
  }
  check('arena admission cannot overwrite another active task or origin', () => {
    const p = player(); run(p, '[proc,macro_drill_start]');
    const before = ['macro_event', 'macro_event_origin_coord', 'macro_event_target_coord', 'macro_transmit'].map(name => p.getVar(v(name)));
    for (const [name, args = []] of [['macro_arnav_start'], ['macro_bob_start', [PlayerStat.FISHING]], ['macro_forester_start'], ['macro_leo_start']]) run(p, `[proc,${name}]`, args);
    assert.deepEqual(['macro_event', 'macro_event_origin_coord', 'macro_event_target_coord', 'macro_transmit'].map(name => p.getVar(v(name))), before);
    run(p, '[proc,macro_arena1_return]', [16]);
    assert.equal(p.getVar(v('macro_event')), 0);
  });
}
console.log(`RESULT ${results.failed ? 'FAIL' : 'PASS'} random-events-arenas1 passed=${results.passed} failed=${results.failed}`);
process.exit(results.failed ? 1 : 0);
