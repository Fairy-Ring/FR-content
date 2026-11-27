import { pathToFileURL } from 'node:url';
import { assert, check, player, run, give, count, reconnect, v, id, types, inv, coord, tile, origin, results, PlayerStat, World, nativeNpcRows, nativeLocRows, locFor, engine } from './runtime.mjs';
import { map } from '../regicide-travel/runtime.mjs';
const { CollisionType } = await import(pathToFileURL(`${engine}/src/engine/routefinder/index.ts`).href);
const selected = process.env.ARENA1_FAMILY;
if (!selected) {
  for (const [start, args, npcNames, locNames] of [
    ['macro_arnav_start', [], [], []],
    ['macro_drill_start', [], ['macro_drilldemon'], ['exercise_mat', 'exercise_mat_10077', 'exercise_mat_10078', 'exercise_mat_10079']],
    ['macro_bob_start', [PlayerStat.FISHING], ['macro_evil_bob_island', 'macro_evil_bob_male_servant', 'macro_evil_bob_female_servant'], ['fishing_spot_8986', 'uncooking_pot', 'portal_8987']],
    ['macro_forester_start', [], ['macro_forester_m', 'macro_pheasant_onetail', 'macro_pheasant_twotail', 'macro_pheasant_threetail', 'macro_pheasant_fourtail'], ['portal_8972']],
    ['macro_leo_start', [], ['macro_gravedigger'], ['grave_12721', 'grave_12722', 'grave_12723', 'grave_12724', 'grave_12725', 'gravestone', 'gravestone_12717', 'gravestone_12718', 'gravestone_12719', 'gravestone_12720', 'mausoleum']],
    ['macro_laf_start', [coord(...origin)], [], ['macro_laf_appendage_1', 'macro_laf_appendage_2', 'macro_laf_appendage_3', 'macro_laf_appendage_4']]
  ]) check(`${start} entry and native interaction targets are collision-connected`, () => {
    const p = player();
    run(p, `[proc,${start}]`, args);
    const event = p.getVar(v('macro_event'));
    assert(event > 0, 'the real start admits the task');
    assert(!map.isMapBlocked(p.x, p.z, p.level), 'the entry tile is walkable');
    const mx = Math.floor(p.x / 64), mz = Math.floor(p.z / 64);
    const tiles = [[p.x, p.z]], visited = new Set([`${p.x},${p.z}`]);
    for (let index = 0; index < tiles.length; index++) {
      const [x, z] = tiles[index];
      for (const [dx, dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
        if (Math.floor(nx / 64) !== mx || Math.floor(nz / 64) !== mz || visited.has(key)) continue;
        if (!map.canTravel(p.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
        visited.add(key); tiles.push([nx, nz]);
      }
    }
    const reachableNpc = (npc, name) => assert(tiles.some(([x, z]) => map.reachedEntity(p.level, x, z, npc.x, npc.z, npc.width, npc.length, 1)), `collision-connected approach to ${name}`);
    if (start === 'macro_arnav_start') {
      const actor = World.getNpcByUid(p.getVar(v('macro_event_uid')));
      assert(actor, 'the real Arnav actor exists');
      reachableNpc(actor, 'Arnav');
    }
    for (const name of npcNames) {
      const rows = nativeNpcRows(name).filter(row => row.mx === mx && row.mz === mz && row.level === p.level);
      assert(rows.length, `native NPC rows exist for ${name}`);
      for (const row of rows) {
        const npc = [...World.npcs].find(candidate => candidate.isActive && candidate.type === row.id && candidate.level === row.level && candidate.x === row.x && candidate.z === row.z);
        assert(npc, `real native NPC exists for ${name}`);
        reachableNpc(npc, name);
      }
    }
    for (const name of locNames) {
      const rows = nativeLocRows(name).filter(row => row.mx === mx && row.mz === mz && row.level === p.level);
      assert(rows.length, `native location rows exist for ${name}`);
      for (const row of rows) {
        const loc = locFor(row), type = types.LocType.get(loc.type);
        assert(tiles.some(([x, z]) => map.reachedLoc(p.level, x, z, loc.x, loc.z, type.width, type.length, 1, loc.angle, loc.shape, type.forceapproach)), `collision-connected approach to ${name}`);
      }
    }
    run(p, '[proc,macro_event_cleanup]', [event, p.getVar(v('macro_event_uid'))]);
  });
}
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
