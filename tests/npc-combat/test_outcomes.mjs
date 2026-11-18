#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runtime } from './outcome_runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.resolve(here, '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const base = option('--base-pack');
const reportFile = option('--report');
const focused = process.argv.includes('--focused');
const registered = JSON.parse(fs.readFileSync(path.join(here, 'outcome-callers.json'), 'utf8'));
const routeSeeds = JSON.parse(fs.readFileSync(path.join(here, 'outcome-route-seeds.json'), 'utf8'));
const watched = ['npc_default_attack', 'npc_meleeattack', 'npc_rangeattack', 'npc_cast_spell', 'npc_cast_spell_with_forced_max_hit', 'npc_spell_success', 'playerhit_n_melee', 'playerhit_n_ranged', 'npc_player_hit_roll', 'npc_spell_cast', 'npc_combat_spell_checks', 'npc_freeze_allowed', 'npc_debuff_allowed', 'npc_spell_fail', 'npc_stat_change_effect', 'npc_freeze_effect'];
const variants = ['hit', 'zero', 'miss', 'protected-hit', 'protected-zero', 'protected-miss', 'pending', 'target-loss', 'npc-busy', 'dead-player'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const effects = result => ({ snapshot: result.snapshot, settled: result.settled, events: result.events.filter(e => /QUEUE|ANIM|SOUND|^MES|DAMAGE|SETMODE|STAT_(ADD|SUB)|^IF_CLOSE|^RUNENERGY|^RANDOM(INC)?$/.test(e.op)), draws: result.draws, randomSources: result.randomSources });
let checks = 0;
function check(label, action) { action(); checks++; console.log(`PASS ${label}`); }
function same(actual, expected, label, full = false) {
  assert.deepEqual(effects(actual), effects(expected), label);
  if (full) assert.deepEqual(actual.events, expected.events, `${label}: ordered reads, computations and effects`);
}
const temporary = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'npc-outcomes-'));
const report = { schema: 1, callerManifest: registered.policy, basePack: Boolean(base), cases: [], costs: [], routeCoverage: [], externalCallers: {}, observedCallers: [], summary: {} };
try {
  const compiled = spawnSync(process.execPath, ['--import', 'tsx', path.join(here, 'compile_outcome_fixture.mjs'), temporary], { cwd: engine, env: process.env, encoding: 'utf8' });
  process.stdout.write(compiled.stdout ?? ''); process.stderr.write(compiled.stderr ?? '');
  assert.equal(compiled.status, 0, 'test-only tuple consumers compile');
  const fixturePack = path.join(temporary, 'engine/data/pack');
  const rt = await runtime(engine, pack);
  const { NpcType, VarPlayerType, VarNpcType } = rt.configs;
  const wind = rt.spell('wind_strike'), curse = rt.spell('confuse'), freeze = rt.spell('bind');
  const spellId = row => rt.field(row, 'spell');
  const inventory = rt.inventory(content, watched);
  check('every external compiled shared-proc caller is registered', () => assert.deepEqual(inventory.externalCallers, registered.externalCallers));
  report.externalCallers = inventory.externalCallers;
  report.npcManifest = inventory.npcs.map(({ npc, poison, entries }) => ({ npc, poison, entries: entries.map(({ trigger, script, paths }) => ({ trigger, script, paths })) }));
  const observed = new Set();
  const namedProcs = new Set(inventory.scripts.map(s => s.name));
  check('no published caller opts into outcomes', () => {
    for (const [caller, targets] of inventory.edges) for (const target of targets) {
      if (target.endsWith('_outcome]')) assert(caller.startsWith('[proc,npc_') && inventory.scripts.find(s => s.name === caller).info.sourceFilePath.startsWith('scripts/skill_combat/scripts/npc/'), caller);
    }
    for (const name of ['npc_meleeattack_outcome', 'npc_default_attack_outcome', 'npc_rangeattack_outcome', 'npc_cast_spell_outcome']) assert(namedProcs.has(`[proc,${name}]`), name);
  });
  function execute(directory, type, name, args, variant, style, configure = null, distance = 1, rng = null) {
    rt.select(directory);
    const f = rt.fixture(type, variant, style, distance);
    let cleanup;
    try {
      if (configure) {
        const configured = configure(f);
        if (typeof configured === 'function') cleanup = configured;
      }
      const actualArgs = typeof args === 'function' ? args(f) : args;
      const result = rt.observe(name, f, actualArgs, variant, rng);
      result.settled = rt.settle(f);
      for (const caller of result.visited) observed.add(caller);
      return result;
    } finally {
      try { cleanup?.(); }
      finally { rt.dispose(); }
    }
  }
  function maximum(style, f) { return rt.run(`[proc,npc_${style === 'melee' ? 'melee' : 'ranged'}_maxhit]`, f).values[0]; }
  function cost(before, after, metadata) {
    const added = Object.fromEntries([...new Set([...Object.keys(before.commands), ...Object.keys(after.commands)])].map(op => [op, (after.commands[op] ?? 0) - (before.commands[op] ?? 0)]).filter(([, count]) => count));
    report.costs.push({ ...metadata, before: before.opcount, after: after.opcount, added });
  }
  function differential(type, name, args, variant, style, metadata = {}, configure = null, distance = 1, rng = null) {
    const head = execute(pack, type, name, args, variant, style, configure, distance, rng);
    if (base) {
      const before = execute(base, type, name, args, variant, style, configure, distance, rng);
      same(head, before, `${type} ${name} ${variant}`, true);
      cost(before, head, { npc: type, entry: name, variant, style, ...metadata });
    }
    report.cases.push({
      npc: type, entry: name, variant, style, comparison: base ? 'base=head' : 'current-pack',
      draws: head.draws.length, randomSources: [...head.randomSources, ...head.settled.randomSources], randomCommands: [...head.events, ...head.settled.events].filter(e => e.op === 'RANDOM' || e.op === 'RANDOMINC'),
      queued: head.snapshot.queued, receivedHP: head.settled.levels[3],
      effects: head.events.filter(e => /QUEUE|^MES|STAT_(ADD|SUB)|^IF_CLOSE|^RUNENERGY|^NPC_SETMODE/.test(e.op)),
      messages: head.settled.messages, presentation: [...head.events, ...head.settled.events].filter(e => /ANIM|SOUND/.test(e.op)),
      behavior: digest({ events: head.events, snapshot: head.snapshot, settled: head.settled }),
      execution: head.snapshot.execution, ...metadata
    });
    return head;
  }
  function delivery(result, style, maximumValue) {
    if (result.snapshot.execution !== rt.State.FINISHED) return;
    const [attempted, accuracy, rolled, delivered, ticks] = result.values;
    assert.equal(result.values.length, 5, 'primitive five-value tuple');
    assert([0, 1].includes(attempted)); assert([-1, 0, 1].includes(accuracy));
    const hits = result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]');
    const expected = attempted && (style !== 'magic' || (accuracy === 1 && maximumValue !== -1)) ? 1 : 0;
    assert.equal(hits.length, expected, 'one ordinary hit, never a duplicate');
    if (hits.length) {
      assert.equal(hits[0].args[0], delivered, 'tuple is the queued magnitude');
      assert.equal(hits[0].delay, ticks, 'tuple is the native queued delay');
    }
    if (!attempted) assert.deepEqual(result.values, [0, -1, 0, 0, 0]);
    if (accuracy !== 1) { assert.equal(rolled, 0); assert.equal(delivered, 0); }
    assert(rolled >= 0 && delivered >= 0);
  }
  const npcs = focused ? inventory.npcs.filter(n => ['cow', 'ardougne_archer', 'bearded_dark_wizard', 'poisonspider', 'swamp_cave_slime', 'slayer_killerwatt', 'druid', 'chaos_druid'].includes(n.npc)) : inventory.npcs;
  for (const record of npcs) {
    const paths = new Set(record.entries.flatMap(entry => entry.paths));
    const styles = [];
    if (paths.has('npc_meleeattack')) styles.push('melee');
    if (paths.has('npc_rangeattack')) styles.push('ranged');
    if (paths.has('npc_cast_spell_with_forced_max_hit')) styles.push('magic');
    for (const style of styles) for (const variant of variants) {
      const ordinary = style === 'melee' ? '[proc,npc_default_attack]' : style === 'ranged' ? '[proc,npc_rangeattack]' : '[proc,npc_cast_spell]';
      const args = style === 'magic' ? [spellId(wind), 4] : [];
      const head = differential(record.npc, ordinary, args, variant, style);
      let maxhit;
      const outcomeArgs = f => {
        maxhit = style === 'magic' ? rt.field(wind, 'maxhit') : maximum(style, f);
        return style === 'melee' ? [maxhit, 0, 0] : style === 'ranged' ? [maxhit, 0, 0] : [spellId(wind), 4, -1, 0, 0];
      };
      const explicit = execute(pack, record.npc, `[proc,${style === 'melee' ? 'npc_default_attack' : style === 'ranged' ? 'npc_rangeattack' : 'npc_cast_spell'}_outcome]`, outcomeArgs, variant, style);
      same(explicit, head, `${record.npc} ${style} ${variant} explicit-prefix drift`);
      delivery(explicit, style, maxhit);
      checks++;
    }
    if (paths.has('npc_default_attack')) for (const variant of ['hit', 'pending', 'target-loss', 'npc-busy', 'pvp-busy', 'dead-player', 'dead-player-pending']) {
      const fixtureVariant = variant === 'dead-player-pending' ? 'dead-player' : variant;
      const configure = f => {
        if (variant === 'pvp-busy') f.player.setVar(rt.id(VarPlayerType, 'lastcombat_pvp'), 100);
        if (variant === 'dead-player-pending') f.npc.setVar(rt.id(VarNpcType, 'npc_action_delay'), 110);
      };
      const ordinary = execute(pack, record.npc, '[proc,npc_default_attack]', [], fixtureVariant, 'melee', configure);
      const ready = execute(pack, record.npc, '[proc,npc_default_attack_ready]', [], fixtureVariant, 'melee', configure);
      const label = `${record.npc} ${variant} readiness ordered prefix`;
      assert.deepEqual(ready.events, ordinary.events.slice(0, ready.events.length), label);
      assert.equal(ready.snapshot.execution, rt.State.FINISHED, label);
      assert.equal(ready.values.length, 1, label);
      assert([0, 1].includes(ready.values[0]), label);
      assert.deepEqual(ready.draws, [], `${label}: no draw`);
      assert.deepEqual(ready.randomSources, [], `${label}: no random source`);
      assert.deepEqual(ready.snapshot.queued, [], `${label}: no queue`);
      if (!ready.values[0]) same(ready, ordinary, `${label}: ordinary refusal`, true);
      checks++;
    }
    const dispatchStyles = new Set(styles);
    if (paths.has('playerhit_n_melee')) dispatchStyles.add('melee');
    if (paths.has('playerhit_n_ranged')) dispatchStyles.add('ranged');
    // A bespoke caller can choose npc_player_hit_roll's style at runtime.
    // Exercise every protection, rather than guessing its style from the graph.
    if (paths.has('npc_player_hit_roll')) for (const style of ['melee', 'ranged', 'magic']) dispatchStyles.add(style);
    for (const entry of record.entries) for (const style of dispatchStyles) for (const variant of variants) differential(record.npc, entry.script, [], variant, style, { trigger: entry.trigger });
    // A bespoke entry can decline before its shared segment. Exercise every
    // changed segment it can reach as well as the real dispatch entry above.
    for (const variant of variants) {
      if (paths.has('npc_player_hit_roll')) differential(record.npc, '[proc,npc_player_hit_roll]', [rt.param(NpcType.getByName(record.npc), 'damagetype')], variant, 'magic');
      if (paths.has('playerhit_n_melee') && !paths.has('npc_meleeattack')) differential(record.npc, '[proc,playerhit_n_melee]', [7, 4], variant, 'melee');
      if (paths.has('playerhit_n_ranged') && !paths.has('npc_rangeattack')) differential(record.npc, '[proc,playerhit_n_ranged]', [7, 67, 4], variant, 'ranged');
      if (paths.has('npc_spell_success') && !paths.has('npc_cast_spell_with_forced_max_hit')) {
        differential(record.npc, '[proc,npc_spell_success]', [wind.id, 7, 67], variant, 'magic');
        differential(record.npc, '[proc,npc_spell_success]', [curse.id, -1, 64], variant, 'magic');
      }
    }
  }
  check(`complete packed NPC prefix matrix (${npcs.length} types)`, () => assert(npcs.length > 0));
  // Dispatch fixtures use uninterrupted seeded streams, not positional forcing:
  // a route may draw a spell/style choice before its accuracy roll.
  const routes = new Map();
  for (const record of inventory.npcs) for (const entry of record.entries) {
    if (!routes.has(entry.script)) routes.set(entry.script, record.npc);
  }
  check('every unique dispatch route has reachable branch seeds', () => {
    assert.equal(routeSeeds.schema, 1); assert.equal(routeSeeds.rng, 'xorshift32');
    assert.deepEqual(routeSeeds.routes.map(r => r.script).sort(), [...routes.keys()].sort());
    for (const route of routeSeeds.routes) {
      assert.equal(route.npc, routes.get(route.script), route.script);
      for (const branch of ['hit', 'zero', 'miss']) {
        assert(Number.isInteger(route.seeds[branch]) || route.unsupportedBranches?.[branch]?.length > 0, `${route.script} lacks ${branch} coverage or a reason`);
      }
    }
  });
  let regionMapEntries;
  const loadedRegionMaps = new Set();
  function configureRoute(f, route) {
    for (const stat of [1, 6]) { f.player.levels[stat] = 20; f.player.baseLevels[stat] = 20; }
    if (route.equipment) f.player.invAdd(rt.id(rt.configs.InvType, 'worn'), rt.id(rt.configs.ObjType, route.equipment), 1);
    for (const [name, value] of Object.entries(route.playerVars ?? {})) {
      const id = VarPlayerType.getId(name);
      if (id >= 0) f.player.setVar(id, value);
      else f.player.setVarBit(rt.id(rt.configs.VarBitType, name), value);
    }
    let cleanup;
    try {
      if (route.privateRegion) {
        const { enter, leave } = route.privateRegion;
        // The ordinary combat fixture loads no maps. Load only the requested
        // real packed squares so both region copying and its exit are native.
        regionMapEntries ??= createRequire(path.join(engine, 'package.json'))('fflate').unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')));
        for (const mapsquare of route.privateRegion.maps) {
          if (loadedRegionMaps.has(mapsquare)) continue;
          const [x, z] = mapsquare.split('_').map(Number);
          const packed = Object.fromEntries(['m', 'l', 'n', 'o'].map(kind => [kind, regionMapEntries[`${kind}${mapsquare}`] ?? new Uint8Array()]));
          assert(packed.m.length && packed.l.length, `packed region source ${mapsquare}`);
          rt.World.gameMap.loadPackedMapsquare(packed, x << 6, z << 6);
          loadedRegionMaps.add(mapsquare);
        }
        const before = rt.World.instances.instances.length;
        const entered = rt.run(enter, f);
        assert.equal(entered.state.execution, rt.State.FINISHED, `${enter} creates the native quest region`);
        const instance = rt.World.instances.findInstanceByCoord(f.player);
        assert(instance, `${enter} puts the player in its region`);
        cleanup = () => {
          const left = rt.run(leave, f);
          assert.equal(left.state.execution, rt.State.FINISHED, `${leave} finishes`);
          assert.equal(rt.World.instances.findInstanceByUid(instance.uid), null, 'route region is torn down');
          assert.equal(rt.World.instances.instances.length, before, 'route leaks no region');
        };
        if (route.privateRegion.spawn) {
          const spawned = rt.run(route.privateRegion.spawn, f);
          assert.equal(spawned.state.execution, rt.State.FINISHED, `${route.privateRegion.spawn} creates the native encounter`);
        }
        f.npc = [...rt.World.npcs].find(npc => npc.type === f.npc.type && rt.World.instances.findInstanceByCoord(npc)?.uid === instance.uid);
        assert(f.npc, `${enter} spawns the route's native NPC`);
        const tile = (f.npc.level << 28) | ((f.npc.x - 1) << 14) | f.npc.z;
        const moved = rt.run('[proc,p_telejump_safe]', f, [tile]);
        assert.equal(moved.state.execution, rt.State.FINISHED, 'native teleport places the combat fixture adjacent');
      }
      for (const [name, value] of Object.entries(route.npcVars ?? {})) f.npc.setVar(rt.id(VarNpcType, name), value === 'target' ? f.player.uid : value);
      rt.run('[proc,player_combat_stat]', f);
      return cleanup;
    } catch (error) {
      cleanup?.();
      throw error;
    }
  }
  function dispatchBranch(result) {
    const hits = result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]');
    if (hits.some(hit => hit.args[0] > 0)) return 'hit';
    if (result.accuracy.includes(true)) return hits.length ? 'zero' : 'success';
    if (result.accuracy.includes(false)) return 'miss';
    return hits.length ? 'zero' : 'no-accuracy';
  }
  for (const route of routeSeeds.routes.filter(r => !focused || npcs.some(n => n.npc === r.npc))) {
    const branches = [];
    for (const [branch, seed] of Object.entries(route.seeds)) check(`${route.script} seeded ${branch}`, () => {
      const result = differential(route.npc, route.script, [], 'seeded', 'melee', { routeBranch: branch, seed }, f => configureRoute(f, route), route.distance ?? 1, { seed });
      assert.equal(dispatchBranch(result), branch, `${route.script} seed=${seed}`);
      branches.push({ branch, seed, accuracy: result.accuracy, queued: result.snapshot.queued, error: result.snapshot.error });
    });
    report.routeCoverage.push({ script: route.script, npc: route.npc, branches, unsupportedBranches: route.unsupportedBranches ?? {} });
  }
  // Every readiness/admission has a refusing fixture as well as an admission.
  for (const [style, type] of [['melee', 'cow'], ['ranged', 'ardougne_archer'], ['magic', 'bearded_dark_wizard']]) {
    const ordinaryName = style === 'melee' ? 'npc_default_attack' : style === 'ranged' ? 'npc_rangeattack' : 'npc_cast_spell';
    for (const variant of ['hit', 'pending', 'target-loss', 'npc-busy', 'pvp-busy', ...(style === 'ranged' ? [] : ['dead-player'])]) check(`${style} ${variant} admission drift and attempted state`, () => {
      const configure = variant === 'pvp-busy' ? f => f.player.setVar(rt.id(VarPlayerType, 'lastcombat_pvp'), 100) : null;
      const ordinary = execute(pack, type, `[proc,${ordinaryName}]`, style === 'magic' ? [spellId(wind), 4] : [], variant, style, configure);
      const explicit = execute(pack, type, `[proc,${ordinaryName}_outcome]`, style === 'magic' ? [spellId(wind), 4, -1, 0, 0] : f => [maximum(style, f), 0, 0], variant, style, configure);
      same(explicit, ordinary, `${style} ${variant} admission prefix`);
      assert.equal(explicit.values[0], Number(variant === 'hit'));
      if (variant !== 'hit') { assert.deepEqual(explicit.values, [0, -1, 0, 0, 0]); assert.equal(explicit.draws.length, 0); }
      if (style === 'melee') {
        const ready = execute(fixturePack, type, '[proc,bc00_test_ready]', [], variant, style, configure);
        same(ready, ordinary, `${variant} readiness-only entry followed by ordinary policy`);
        assert.equal(ready.values[0], explicit.values[0]);
      }
    });
  }
  for (const [row, variable, stat] of [[freeze, 'frozen', null], [curse, null, 0], [rt.spell('weaken'), null, 2], [rt.spell('curse'), null, 1]]) {
    for (const admitted of [false, true]) check(`${row.debugname} ${admitted ? 'admitted' : 'refused'} magic admission drift`, () => {
      const configure = f => {
        if (variable) f.player.setVar(rt.id(VarPlayerType, variable), admitted ? 0 : 110);
        else if (!admitted) f.player.levels[stat]--;
      };
      const ordinary = execute(pack, 'bearded_dark_wizard', '[proc,npc_cast_spell]', [spellId(row), 4], 'hit', 'magic', configure);
      const explicit = execute(pack, 'bearded_dark_wizard', '[proc,npc_cast_spell_outcome]', [spellId(row), 4, -1, 0, 0], 'hit', 'magic', configure);
      same(explicit, ordinary, `${row.debugname} explicit spell admission`);
      assert.equal(explicit.values[0], Number(admitted));
      if (!admitted) { assert.deepEqual(explicit.values, [0, -1, 0, 0, 0]); assert.equal(explicit.draws.length, 0); }
    });
  }
  check('Verac test caller draws once after readiness and before accuracy', () => {
    for (const variant of ['pending', 'target-loss', 'npc-busy', 'dead-player']) {
      const refused = execute(fixturePack, 'cow', '[proc,bc00_test_verac]', [], variant, 'melee');
      assert.deepEqual(refused.values, [0, -1, 0, 0, 0]); assert.equal(refused.draws.length, 0);
    }
    for (const protectedTrial of [false, true]) for (const proc of [false, true]) {
      const result = execute(fixturePack, 'cow', '[proc,bc00_test_verac]', [], protectedTrial ? 'protected-hit' : 'hit', 'melee', null, 1, { draws: [proc ? 0 : 0.9, 0.999999, 0, 0.999999] });
      const random = result.events.filter(e => e.op === 'RANDOM' || e.op === 'RANDOMINC');
      assert.equal(random[0].op, 'RANDOM'); assert.deepEqual(random[0].in, [4]);
      assert.equal(result.draws.length, proc ? 2 : protectedTrial ? 3 : 4);
      assert.equal(result.values[3], proc ? protectedTrial ? 15 : 23 : protectedTrial ? 0 : 23);
      assert(result.events.findIndex(e => e.op === 'NPC_ANIM') < result.events.findIndex(e => e.op === 'RANDOM'));
      delivery(result, 'melee', proc && protectedTrial ? 15 : 23);
    }
  });
  check('typed queue references use compiled names after pack regeneration', () => {
    const result = execute(pack, 'cow', '[proc,npc_default_attack]', [], 'hit', 'melee');
    const queues = result.events.filter(event => event.op === 'QUEUE' || event.op === 'QUEUE*');
    assert(queues.length > 0);
    for (const event of queues) assert.match(event.in.at(-1), /^\[queue,/);
  });
  for (const [style, type] of [['melee', 'cow'], ['ranged', 'ardougne_archer'], ['magic', 'bearded_dark_wizard']]) {
    const entry = `[proc,bc00_test_${style}]`;
    const args = style === 'melee' ? [7, 2, 0] : style === 'ranged' ? [7, 0, 0] : [spellId(wind), 4, 7, 0, 0];
    const result = execute(fixturePack, type, entry, args, 'hit', style);
    check(`${style} compiled caller receives tuple and applies its own effect`, () => { assert.deepEqual(result.values.slice(0, 4), [1, 1, 7, 7]); assert.equal(result.snapshot.levels[1], 79); delivery(result, style, 7); });
    check(`${style} pending compiled caller has no special`, () => {
      const pending = execute(fixturePack, type, entry, args, 'pending', style);
      assert.deepEqual(pending.values, [0, -1, 0, 0, 0]); assert.equal(pending.snapshot.levels[1], 80); assert.equal(pending.draws.length, 0);
    });
  }
  check('unconditional melee skips both accuracy draws and uses the supplied protected cap', () => {
    const result = execute(fixturePack, 'cow', '[proc,bc00_test_melee]', [15, 2, 0], 'protected-hit', 'melee');
    assert.deepEqual(result.values, [1, 1, 15, 15, 0]); assert.equal(result.draws.length, 1); delivery(result, 'melee', 15);
  });
  check('armour-only policy retains native level/prayer/style but ignores equipment defence', () => {
    for (const level of [30, 80]) for (const stance of [0, 2]) for (const prayer of [false, true]) {
      const prepare = f => {
        f.player.levels[1] = level; f.player.baseLevels[1] = level;
        // Native unarmed mode 2 selects defensive stance and its +3 bonus.
        f.player.setVar(rt.id(VarPlayerType, 'com_mode'), stance);
        f.player.setVar(rt.id(VarPlayerType, 'prayer9'), Number(prayer));
        rt.run('[proc,player_combat_stat]', f);
      };
      const ordinary = execute(pack, 'cow', '[proc,npc_meleeattack_outcome]', [7, 0, 0], 'hit', 'melee', prepare);
      const unarmoured = execute(pack, 'cow', '[proc,npc_meleeattack_outcome]', [7, 1, 0], 'hit', 'melee', prepare);
      same(unarmoured, ordinary, 'no equipment is exactly the native defence');
      const armoured = execute(pack, 'cow', '[proc,npc_meleeattack_outcome]', [7, 1, 0], 'hit', 'melee', f => { prepare(f); for (const name of ['com_stabdef', 'com_slashdef', 'com_crushdef']) f.player.setVar(rt.id(VarPlayerType, name), 1000000); });
      const nativeDefence = ordinary.events.filter(e => e.op === 'RANDOMINC')[1].in;
      assert.deepEqual(armoured.events.filter(e => e.op === 'RANDOMINC')[1].in, nativeDefence, 'cached equipment roll is not reused');
      const protectedResult = execute(pack, 'cow', '[proc,npc_meleeattack_outcome]', [7, 1, 0], 'protected-hit', 'melee', prepare);
      assert.equal(protectedResult.values[3], 0); assert.equal(protectedResult.draws.length, 2);
    }
  });
  for (const style of ['melee', 'ranged']) check(`${style} requested protected result is one latent roll and zero delivered`, () => {
    const type = style === 'melee' ? 'cow' : 'ardougne_archer';
    const result = execute(pack, type, `[proc,npc_${style === 'melee' ? 'meleeattack' : 'rangeattack'}_outcome]`, style === 'melee' ? [7, 0, 1] : [7, 1, 0], 'protected-hit', style);
    assert.deepEqual(result.values.slice(0, 4), [1, 1, 7, 0]); assert.equal(result.draws.length, 3); delivery(result, style, 7);
  });
  for (const row of [wind, curse, freeze]) for (const variant of ['protected-hit', 'protected-miss']) check(`magic ${row.debugname} ${variant} retains one splash and no protected stat/freeze success`, () => {
    const native = execute(pack, 'bearded_dark_wizard', '[proc,npc_cast_spell_outcome]', [spellId(row), 4, -1, 0, 0], variant, 'magic');
    const latent = execute(pack, 'bearded_dark_wizard', '[proc,npc_cast_spell_outcome]', [spellId(row), 4, -1, 1, 0], variant, 'magic');
    assert.deepEqual(latent.snapshot, native.snapshot); assert.deepEqual(latent.settled, native.settled);
    assert.equal(latent.events.filter(e => e.op === 'SPOTANIM_PL').length, 1, 'exactly the native failed impact');
    assert.equal(latent.snapshot.queued.filter(q => q.script === '[queue,npc_freeze_player]').length, 0);
    assert.equal(latent.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]').length, 0);
    assert.deepEqual(latent.values.slice(0, 2), [1, variant.endsWith('miss') ? 0 : 1]);
    assert.equal(latent.values[3], 0); assert.equal(latent.draws.length, variant.endsWith('miss') ? 2 : 3);
  });
  for (const row of [wind, rt.spell('fire_wave'), curse, rt.spell('weaken'), rt.spell('curse'), freeze]) {
    for (const latentRequest of [0, 1]) for (const variant of ['protected-hit', 'protected-zero', 'protected-miss']) check(`${row.debugname} protected success-effects request=${latentRequest} ${variant}`, () => {
      const args = [spellId(row), 6, -1, latentRequest, 1];
      const result = execute(fixturePack, 'bearded_dark_wizard', '[proc,bc00_test_magic]', args, variant, 'magic');
      const hit = !variant.endsWith('miss');
      assert.deepEqual(result.values.slice(0, 2), [1, Number(hit)]);
      assert.equal(result.values[3], 0); assert.equal(result.values[4], 0);
      assert.equal(result.draws.length, hit ? 3 : 2);
      assert.equal(result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]' || q.script === '[queue,poison_player]').length, 0);
      const expected = execute(fixturePack, 'bearded_dark_wizard', '[proc,bc00_test_magic]', [spellId(row), 6, -1, 1, 0], hit ? variant.replace('protected-', '') : variant, 'magic');
      const nonDamage = r => r.events.filter(e => /SOUND|SPOTANIM_PL|^IF_CLOSE|^MES|STAT_(ADD|SUB)/.test(e.op) || e.op.startsWith('QUEUE') && ['[queue,playerhit_n_retaliate]', '[queue,npc_freeze_player]'].includes(e.in.at(-1)));
      assert.deepEqual(nonDamage(result), nonDamage(expected), 'one native success/failure presentation, retaliation and standard effects');
      assert.deepEqual(result.snapshot.levels, expected.snapshot.levels, 'standard stat effect, once');
      assert.equal(result.settled.vars[rt.id(VarPlayerType, 'frozen')], expected.settled.vars[rt.id(VarPlayerType, 'frozen')], 'standard freeze, once');
      if (hit) {
        for (const variable of ['lastcombat', 'aggressive_npc']) {
          const id = rt.id(VarPlayerType, variable);
          assert.equal(result.snapshot.playerVars[id], expected.snapshot.playerVars[id], `protected success attack variable ${variable}`);
        }
        const attackingUid = rt.id(VarNpcType, 'npc_attacking_uid');
        assert.equal(result.snapshot.npcVars[attackingUid], expected.snapshot.npcVars[attackingUid], 'protected success attack variable npc_attacking_uid');
        assert.equal(result.events.filter(e => e.op === 'SPOTANIM_PL').length, 1);
        const draws = result.events.flatMap((e, i) => e.op === 'RANDOMINC' ? [i] : []);
        const cast = result.events.findIndex((e, i) => i > draws[1] && e.op === 'SOUND_SYNTH');
        assert(cast > draws[1] && cast < draws[2], 'cast sound before the single magnitude');
        assert.equal(result.values[2], rt.field(row, 'maxhit') < 0 || variant.endsWith('zero') ? 0 : rt.field(row, 'maxhit'));
      }
    });
    check(`${row.debugname} success-effects input does not change an unprotected attack`, () => {
      const disabled = execute(pack, 'bearded_dark_wizard', '[proc,npc_cast_spell_outcome]', [spellId(row), 6, -1, 0, 0], 'hit', 'magic');
      const enabled = execute(pack, 'bearded_dark_wizard', '[proc,npc_cast_spell_outcome]', [spellId(row), 6, -1, 0, 1], 'hit', 'magic');
      same(enabled, disabled, 'unprotected flag is inert'); assert.deepEqual(enabled.values, disabled.values);
    });
  }
  for (const [style, type] of [['melee', 'poisonspider'], ['ranged', 'ardougne_archer']]) check(`${style} poisonous protected native attack retains its three draws and one poison queue`, () => {
    const npc = NpcType.getByName(type), original = npc.params, severity = rt.param(NpcType.getByName('poisonspider'), 'poison_severity');
    try {
      // No published generic ranged NPC needs poison today. Exercise the shared
      // published poison branch with one labelled in-memory config fixture.
      npc.params = new Map(original); npc.params.set(rt.configs.ParamType.getByName('poison_severity').id, severity);
      const ordinaryName = style === 'melee' ? 'npc_default_attack' : 'npc_rangeattack';
      const ordinary = differential(type, `[proc,${ordinaryName}]`, [], 'protected-poison-hit', style, { poisonFixture: severity });
      const explicit = execute(pack, type, `[proc,${ordinaryName}_outcome]`, f => [maximum(style, f), 0, 0], 'protected-poison-hit', style);
      same(explicit, ordinary, 'poisonous explicit prefix retains native behaviour');
      assert.deepEqual(explicit.values.slice(0, 2), [1, 1]); assert(explicit.values[2] > 0); assert.equal(explicit.values[3], 0);
      assert.equal(explicit.draws.length, 3); delivery(explicit, style, explicit.values[2]);
      assert.equal(explicit.snapshot.queued.filter(q => q.script === '[queue,poison_player]').length, 1);
    } finally { npc.params = original; }
  });
  const presentation = ['rangeattack_sound', 'proj_launch', 'proj_travel'];
  for (const distance of [1, 7, 13]) for (let mask = 0; mask < 8; mask++) {
    const npc = NpcType.getByName('ardougne_archer'), original = npc.params;
    try {
      const reference = execute(pack, npc.debugname, '[proc,npc_rangeattack_outcome]', [7, 0, 0], 'hit', 'ranged', null, distance);
      npc.params = new Map(original);
      for (let bit = 0; bit < 3; bit++) if (mask & (1 << bit)) npc.params.set(rt.configs.ParamType.getByName(presentation[bit]).id, -1);
      const optional = execute(pack, npc.debugname, '[proc,npc_rangeattack_outcome]', [7, 0, 1], 'hit', 'ranged', null, distance);
      check(`independent null presentation mask=${mask} distance=${distance}`, () => {
        assert.equal(optional.snapshot.execution, rt.State.FINISHED); assert.deepEqual(optional.values, reference.values); delivery(optional, 'ranged', 7);
        assert.equal(optional.values[4], Math.floor((32 + 5 * distance) / 30));
        assert.equal(optional.events.filter(e => e.op === 'PROJANIM_PL').length, mask & 4 ? 0 : 1);
        assert.equal(optional.events.filter(e => e.op === 'SOUND_SYNTH').length, mask & 1 ? 0 : 1);
        assert.equal(optional.events.filter(e => e.op === 'SPOTANIM_NPC').length, mask & 2 ? 0 : 1);
      });
      if (mask) {
        const strict = execute(pack, npc.debugname, '[proc,npc_rangeattack]', [], 'hit', 'ranged', null, distance);
        check(`ordinary missing assets stay strict mask=${mask} distance=${distance}`, () => assert.equal(strict.snapshot.execution, rt.State.ABORTED));
        if (base) same(strict, execute(base, npc.debugname, '[proc,npc_rangeattack]', [], 'hit', 'ranged', null, distance), 'strict head and base abort identically', true);
      }
    } finally { npc.params = original; }
  }
  for (const [style, type] of [['melee', 'cow'], ['ranged', 'ardougne_archer'], ['magic', 'bearded_dark_wizard']]) check(`${style} native random/presentation/queue order`, () => {
    const result = execute(pack, type, `[proc,${style === 'melee' ? 'npc_default_attack' : style === 'ranged' ? 'npc_rangeattack' : 'npc_cast_spell'}]`, style === 'magic' ? [spellId(wind), 4] : [], 'hit', style);
    const firstDraw = result.events.findIndex(e => e.op === 'RANDOMINC');
    const animation = result.events.findIndex(e => e.op === 'NPC_ANIM');
    const queue = result.events.findIndex(e => e.op === 'QUEUE');
    const draws = result.events.map((e, i) => e.op === 'RANDOMINC' ? i : -1).filter(i => i >= 0);
    assert.equal(draws.length, 3); assert(animation >= 0 && animation < firstDraw); assert(queue > draws[2]);
    if (style === 'magic') { const sound = result.events.findIndex((e, i) => i > draws[1] && e.op === 'SOUND_SYNTH'); assert(sound > draws[1] && sound < draws[2]); }
    if (style === 'ranged') assert(result.events.findIndex(e => e.op === 'PROJANIM_PL') < firstDraw);
  });
  for (const variant of ['dead-npc', 'dead-player', 'target-loss']) {
    const result = execute(pack, 'cow', '[proc,npc_default_attack_outcome]', [7, 0, 0], variant, 'melee');
    check(`melee ${variant} tuple follows native delivery`, () => { assert.equal(result.values[3], 0); if (variant !== 'dead-npc') assert.deepEqual(result.values, [0, -1, 0, 0, 0]); });
  }
  // These shared callers bypass the generic magic wrapper. Both returning
  // statement calls and their complete native spell effects must stay compatible.
  for (const [type, caller] of [['druid', 'npc_druid_entangle'], ['chaos_druid', 'chaos_druid_spell'], ['firediamond_firewarrior', 'dt_fareed_cast']]) for (const variant of ['hit', 'miss', 'protected-hit']) {
    rt.select(pack);
    if (!NpcType.getByName(type)) throw new Error(`Unaccounted spell-success NPC ${type}`);
    differential(type, `[proc,${caller}]`, [], variant, 'magic');
  }
  if (!focused) check('all registered external callers execute in the compiled matrix', () => assert.deepEqual([...new Set(Object.values(registered.externalCallers).flat())].filter(caller => !observed.has(caller)), []));
  if (base) check('every ordinary command delta is primitive call/return/local bookkeeping', () => {
    const allowed = new Set(['GOSUB_WITH_PARAMS', 'POP_INT_DISCARD', 'POP_INT_LOCAL', 'PUSH_CONSTANT_INT', 'PUSH_INT_LOCAL', 'RETURN']);
    for (const row of report.costs) for (const opcode of Object.keys(row.added)) assert(allowed.has(opcode), `${row.npc} ${row.entry} ${row.variant}: ${opcode}`);
  });
  report.observedCallers = [...observed].sort();
  report.summary = { checks, npcTypes: npcs.length, routes: npcs.reduce((n, r) => n + r.entries.length, 0), uniqueDispatchRoutes: report.routeCoverage.length, seededRouteCases: report.routeCoverage.reduce((n, r) => n + r.branches.length, 0), differentialCases: report.costs.length, passed: true };
  console.log(`RESULT PASS npc-combat-outcomes checks=${checks} npcTypes=${npcs.length} sameRunCases=${report.costs.length}`);
} catch (error) {
  report.summary = { checks, passed: false, error: error.stack };
  console.error(error.stack); process.exitCode = 1;
} finally {
  if (reportFile) fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  fs.rmSync(temporary, { recursive: true, force: true });
}
// World imports retain native worker handles even after an offline VM run.
process.exit(process.exitCode ?? 0);
