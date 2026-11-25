#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const loadEngineModule = relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
const registered = JSON.parse(fs.readFileSync(path.join(here, 'outcome-callers.json'), 'utf8'));
const routeSeeds = JSON.parse(fs.readFileSync(path.join(here, 'outcome-route-seeds.json'), 'utf8'));
const watched = ['npc_default_attack', 'npc_meleeattack', 'npc_rangeattack', 'npc_cast_spell', 'npc_cast_spell_with_forced_max_hit', 'npc_spell_success', 'playerhit_n_melee', 'playerhit_n_ranged', 'npc_player_hit_roll', 'npc_spell_cast', 'npc_combat_spell_checks', 'npc_freeze_allowed', 'npc_debuff_allowed', 'npc_spell_fail', 'npc_stat_change_effect', 'npc_freeze_effect'];
const variants = ['hit', 'zero', 'miss', 'protected-hit', 'protected-zero', 'protected-miss', 'pending', 'target-loss', 'npc-busy', 'dead-player'];
const MAX_ROUTE_SEED_FALLBACK_ATTEMPTS = 32;
const ROUTE_SEED_MULTIPLIER = 0x9e3779b9;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const effects = result => ({ snapshot: result.snapshot, settled: result.settled, events: result.events.filter(e => /QUEUE|ANIM|SOUND|^MES|DAMAGE|SETMODE|STAT_(ADD|SUB)|^IF_CLOSE|^RUNENERGY|^RANDOM(INC)?$/.test(e.op)), draws: result.draws, randomSources: result.randomSources });
let checks = 0;
function check(label, action) { action(); checks++; console.log(`PASS ${label}`); }
function same(actual, expected, label, full = false) {
  assert.deepEqual(effects(actual), effects(expected), label);
  if (full) assert.deepEqual(actual.events, expected.events, `${label}: ordered reads, computations and effects`);
}
const temporary = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'npc-outcomes-'));
const report = { schema: 1, callerManifest: registered.policy, basePack: Boolean(base), routeSeedSearch: { method: 'preferred manifest seed, then unsigned multiples via Math.imul(index, 0x9e3779b9) >>> 0', maxFallbackAttempts: MAX_ROUTE_SEED_FALLBACK_ATTEMPTS, attemptsIncludePreferred: true }, cases: [], costs: [], routeCoverage: [], externalCallers: {}, observedCallers: [], summary: {} };
try {
  const compiled = spawnSync(process.execPath, ['--import', 'tsx', path.join(here, 'compile_outcome_fixture.mjs'), temporary], { cwd: engine, env: process.env, encoding: 'utf8' });
  process.stdout.write(compiled.stdout ?? ''); process.stderr.write(compiled.stderr ?? '');
  assert.equal(compiled.status, 0, 'test-only tuple consumers compile');
  const fixturePack = path.join(temporary, 'engine/data/pack');
  const rt = await runtime(engine, pack);
  const { NpcType, VarPlayerType, VarNpcType } = rt.configs;
  // Initialize World through runtime first; direct runner-first loading cycles
  // through the engine's entity modules before NonPathingEntity is ready.
  const ResumePauseButton = (await loadEngineModule('network/game/client/model/ResumePauseButton.ts')).default;
  const ResumePauseButtonHandler = (await loadEngineModule('network/game/client/handler/ResumePauseButtonHandler.ts')).default;
  const resumePauseButtonHandler = new ResumePauseButtonHandler();
  const ScriptRunner = (await loadEngineModule('engine/script/ScriptRunner.ts')).default;
  const ScriptPointer = (await loadEngineModule('engine/script/ScriptPointer.ts')).default;
  const ServerTriggerType = (await loadEngineModule('engine/script/ServerTriggerType.ts')).default;
  const JavaRandom = (await loadEngineModule('util/JavaRandom.ts')).default;
  const wind = rt.spell('wind_strike'), curse = rt.spell('confuse'), freeze = rt.spell('bind');
  const spellId = row => rt.field(row, 'spell');
  const inventory = rt.inventory(content, watched);
  check('every external compiled shared-proc caller is registered', () => assert.deepEqual(inventory.externalCallers, registered.externalCallers));
  report.externalCallers = inventory.externalCallers;
  report.npcManifest = inventory.npcs.map(({ npc, poison, entries }) => ({ npc, poison, entries: entries.map(({ trigger, script, paths }) => ({ trigger, script, paths })) }));
  const census = report.presentationCensus = { cases: [], excluded: [] };
  const coveredNpcTypes = new Set(inventory.npcs.map(record => record.npc));
  for (const npc of NpcType.configs) {
    if (npc?.debugname && !coveredNpcTypes.has(npc.debugname)) census.excluded.push(npc.debugname);
  }
  console.log(`PRESENTATION_CENSUS excludedTypes=${census.excluded.length}`);
  check('excluded NPC types require an explicit census-list edit', () => {
    const exclusions = JSON.parse(fs.readFileSync(path.join(here, 'outcome-census-exclusions.json'), 'utf8'));
    assert.deepEqual([...census.excluded].sort(), [...exclusions].sort());
  });
  const observed = new Set();
  const namedProcs = new Set(inventory.scripts.map(s => s.name));
  check('no published caller opts into outcomes', () => {
    for (const [caller, targets] of inventory.edges) for (const target of targets) {
      if (target.endsWith('_outcome]')) assert((caller.startsWith('[proc,npc_') && inventory.scripts.find(s => s.name === caller).info.sourceFilePath.startsWith('scripts/skill_combat/scripts/npc/')) || caller === '[proc,barrows_skeleton_attack]' || caller === '[proc,barrows_torag_attack]' || caller === '[proc,barrows_guthan_attack]' || caller === '[proc,barrows_verac_attack]', caller);
    }
    for (const name of ['npc_meleeattack_outcome', 'npc_default_attack_outcome', 'npc_rangeattack_outcome', 'npc_cast_spell_outcome']) assert(namedProcs.has(`[proc,${name}]`), name);
  });
  function execute(directory, type, name, args, variant, style, configure = null, distance = 1, rng = null, fixtureType = type, trackObserved = true, lateVariant = false) {
    rt.select(directory);
    const f = rt.fixture(fixtureType, lateVariant ? 'hit' : variant, style, distance);
    let cleanup;
    try {
      if (configure) {
        const configured = configure(f);
        if (typeof configured === 'function') cleanup = configured;
      }
      if (lateVariant) rt.applyVariant(f, variant, style);
      const actualArgs = typeof args === 'function' ? args(f) : args;
      const dispatchDistance = Math.max(
        f.npc.x - f.player.x, f.player.x - (f.npc.x + f.npc.width - 1),
        f.npc.z - f.player.z, f.player.z - (f.npc.z + f.npc.length - 1), 0);
      const result = rt.observe(name, f, actualArgs, variant, rng);
      result.settled = rt.settle(f);
      if (name.startsWith('[ai_')) census.cases.push({
        npc: type, script: name, variant, seed: rng?.seed, distance: dispatchDistance,
        execution: result.snapshot.execution, error: result.snapshot.error,
        settledError: result.settled.error, diagnostics: result.errors
      });
      if (trackObserved) for (const caller of result.visited) observed.add(caller);
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
  function differential(type, name, args, variant, style, metadata = {}, configure = null, distance = 1, rng = null, compareBase = true, fixtureType = type, selectedHead = null) {
    const head = selectedHead ?? execute(pack, type, name, args, variant, style, configure, distance, rng, fixtureType);
    for (const caller of head.visited) observed.add(caller);
    if (base && compareBase) {
      const before = execute(base, type, name, args, variant, style, configure, distance, rng, fixtureType);
      same(head, before, `${type} ${name} ${variant}`, true);
      cost(before, head, { npc: type, entry: name, variant, style, ...metadata });
    }
    report.cases.push({
      npc: type, entry: name, variant, style, comparison: base && compareBase ? 'base=head' : 'current-pack',
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
  function advanceHopeLives(f, route, instance) {
    assert.equal(route.prelude, 'soulbane-hope-lives', 'known native route prelude');
    const types = ['soulbane_hope_monst3', 'soulbane_hope_monst2', 'soulbane_hope_monst1'].map(name => rt.id(NpcType, name));
    const wanted = types.indexOf(f.npc.type);
    assert(wanted > 0, `${route.script}: the prelude requires a later Hope life`);
    const owner = rt.id(VarNpcType, 'npc_attacking_uid');
    const marker = rt.id(VarNpcType, 'npc_int');
    const regionHandle = f.player.getVar(rt.id(VarPlayerType, 'soulbane_instance'));
    assert.equal(regionHandle, instance.uid + 1, 'native entry retains the quest one-based region handle');
    const tally = rt.id(rt.configs.VarBitType, 'soulbane_hope_killedtally');
    const actionDelay = rt.id(VarNpcType, 'npc_action_delay');
    const npc = [...rt.World.npcs].find(npc => npc.type === types[0]
      && rt.World.instances.findInstanceByCoord(npc)?.uid === instance.uid);
    assert(npc, `${route.script}: entry creates a real first-life Hope creature`);
    assert.equal(npc.getVar(owner) >>> 0, f.player.uid, 'native Hope creature belongs to this player');
    assert.equal(npc.getVar(marker), regionHandle, 'native Hope creature belongs to this private region');
    f.npc = npc;
    const started = rt.run('[ai_opplayer2,soulbane_hope_monst3]', f);
    assert.equal(started.state.execution, rt.State.FINISHED, 'native Hope attack establishes its combat target');
    const Trigger = createRequire(path.join(engine, 'package.json'))('./src/engine/script/ServerTriggerType.ts').default;
    const tick = () => {
      rt.World.processNpcEventQueue();
      npc.turn();
      f.player.processQueues();
      rt.World.currentTick++;
    };
    for (let life = 0; life < wanted; life++) {
      assert.equal(npc.type, types[life], 'Hope prelude starts on the preceding native life');
      assert.equal(npc.levels[3], 21, 'native Hope life starts with its packed full HP');
      // Disclosed damage inputs use the same native AI_QUEUE2 entry as the
      // Soulbane queued-hit regression; no HP, form or quest variable is seeded.
      npc.enqueueScript(Trigger.AI_QUEUE2, 0, 7);
      tick();
      assert.equal(npc.levels[3], 14, 'native damage actually removes seven HP before the death input');
      npc.enqueueScript(Trigger.AI_QUEUE2, 0, npc.levels[3]);
      for (let boundary = 0; boundary < 256 && npc.isActive && (npc.type === types[life] || npc.delayed); boundary++) tick();
      assert(npc.isActive, 'a native nonfinal death retains the same Hope creature');
      assert.equal(npc.type, types[life + 1], 'only native death produces the required next Hope life');
      assert.equal(npc.levels[3], 21, 'native death restores the next life to full HP');
      assert.equal(f.player.getVarBit(tally), 0, 'nonfinal native deaths earn no final-life credit');
    }
    for (let boundary = 0; boundary < 16 && (npc.delayed || npc.getVar(actionDelay) > rt.World.currentTick); boundary++) tick();
    assert(!npc.delayed && npc.getVar(actionDelay) <= rt.World.currentTick, 'native Hope attack delay expires without resetting it');
    assert.equal(npc.type, types[wanted], `${route.script}: the requested form exists through native deaths`);
    assert.equal(npc.getVar(owner) >>> 0, f.player.uid, 'native life changes retain their owner');
    assert.equal(npc.getVar(marker), regionHandle, 'native life changes retain their private region');
  }
  function configureRoute(f, route) {
    for (const stat of [1, 6]) { f.player.levels[stat] = 20; f.player.baseLevels[stat] = 20; }
    if (route.equipment) f.player.invAdd(rt.id(rt.configs.InvType, 'worn'), rt.id(rt.configs.ObjType, route.equipment), 1);
    for (const [name, value] of Object.entries(route.playerVars ?? {})) {
      if (route.prelude === 'soulbane-tolna-intro' && name === 'soulbane_prog') {
        assert.equal(value, 9, `${route.script}: only the disclosed stage-9 prerequisite is seeded`);
        // stage 9 seeded as a prerequisite; not a progression proof
        f.player.setVarBit(rt.id(rt.configs.VarBitType, 'soulbane_prog'), value);
        continue;
      }
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
        const beforeNpcCount = [...rt.World.npcs].length;
        const createdInstances = [];
        const entered = rt.run(enter, f);
        assert.equal(entered.state.execution, rt.State.FINISHED, `${enter} creates the native quest region`);
        const instance = rt.World.instances.findInstanceByCoord(f.player);
        assert(instance, `${enter} puts the player in its region`);
        createdInstances.push(instance);
        cleanup = () => {
          const activeInstance = rt.World.instances.findInstanceByCoord(f.player);
          if (activeInstance) {
            const left = rt.run(leave, f);
            assert.equal(left.state.execution, rt.State.FINISHED, `${leave} finishes`);
          }
          for (const created of createdInstances) {
            assert(!rt.World.instances.instances.includes(created), 'every native route region is torn down');
          }
          assert.equal(rt.World.instances.instances.length, before, 'route leaks no region');
          if (route.prelude === 'soulbane-tolna-intro') assert.equal([...rt.World.npcs].length, beforeNpcCount, 'Tolna route teardown preserves the NPC count');
        };
        if (route.privateRegion.spawn) {
          const spawned = rt.run(route.privateRegion.spawn, f);
          assert.equal(spawned.state.execution, rt.State.FINISHED, `${route.privateRegion.spawn} creates the native encounter`);
        }
        if (route.prelude === 'soulbane-hope-lives') advanceHopeLives(f, route, instance);
        else if (route.prelude === 'soulbane-tolna-intro') advanceTolnaIntro(f, route, instance, createdInstances, before);
        else assert.equal(route.prelude, undefined, `${route.script}: known native route prelude`);
        if (route.prelude !== 'soulbane-tolna-intro') {
          f.npc = [...rt.World.npcs].find(npc => npc.type === f.npc.type && rt.World.instances.findInstanceByCoord(npc)?.uid === instance.uid);
          assert(f.npc, `${enter} spawns the route's native NPC`);
          const tile = (f.npc.level << 28) | ((f.npc.x - 1) << 14) | f.npc.z;
          const moved = rt.run('[proc,p_telejump_safe]', f, [tile]);
          assert.equal(moved.state.execution, rt.State.FINISHED, 'native teleport places the combat fixture adjacent');
        }
      }
      for (const [name, value] of Object.entries(route.npcVars ?? {})) f.npc.setVar(rt.id(VarNpcType, name), value === 'target' ? f.player.uid : value);
      rt.run('[proc,player_combat_stat]', f);
      return cleanup;
    } catch (error) {
      cleanup?.();
      throw error;
    }
  }
  const tolnaProfiles = {
    soulbane_tolna_south: { head: 'soulbane_final_tolna1', meleeTicks: 8, rangedTicks: 7, attackRate: 8, damageType: 1 },
    soulbane_tolna_east: { head: 'soulbane_final_tolna2', meleeTicks: 0, rangedTicks: 5, attackRate: 5, damageType: null },
    soulbane_tolna_north: { head: 'soulbane_final_tolna3', meleeTicks: 3, rangedTicks: 20, attackRate: 3, damageType: 0 }
  };
  function tolnaRowValue(row, name) {
    const table = rt.configs.DbTableType.getByName('soulbane_tolna_heads');
    assert(table, 'packed Tolna head profile table');
    const column = table.columnNames.indexOf(name);
    assert(column >= 0, `Tolna profile column ${name}`);
    return row.getValue(column, 0)[0];
  }
  function assertTolnaSourceProfile(f, head, profileName) {
    const expected = tolnaProfiles[profileName];
    assert(expected, `source profile ${profileName}`);
    const config = NpcType.getByName(expected.head);
    assert(config, `packed head ${expected.head}`);
    assert.equal(head.type, config.id, `${profileName} native head type`);
    assert.deepEqual(Array.from(config.stats), [42, 40, 41, 37, 1, 1], `${profileName} source combat levels`);
    assert.deepEqual(Array.from(head.levels), [42, 40, 41, 37, 1, 1], `${profileName} spawned combat levels`);
    assert.equal(head.levels[3], 37, `${profileName} starts at its native 37 HP`);
    assert.equal(rt.param(config, 'attackrate'), expected.attackRate, `${profileName} native attack interval`);
    for (const [name, value] of Object.entries({
      attackbonus: 0, strengthbonus: 0, rangeattack: 0, rangebonus: 0,
      stabdefence: 0, slashdefence: 0, crushdefence: 0, magicdefence: 50, rangedefence: 50
    })) assert.equal(rt.param(config, name), value, `${profileName} source ${name}`);
    if (expected.damageType !== null) assert.equal(rt.param(config, 'damagetype'), expected.damageType, `${profileName} source melee damage style`);

    const row = rt.configs.DbRowType.getByName(profileName);
    assert(row, `packed profile row ${profileName}`);
    assert.equal(tolnaRowValue(row, 'head'), config.id, `${profileName} maps to its head`);
    assert.equal(tolnaRowValue(row, 'melee_ticks'), expected.meleeTicks, `${profileName} source melee interval`);
    assert.equal(tolnaRowValue(row, 'ranged_ticks'), expected.rangedTicks, `${profileName} source ranged interval`);
    const resolved = rt.run('[proc,soulbane_tolna_headrow]', { npc: head, player: f.player });
    assert.equal(resolved.state.execution, rt.State.FINISHED, `${profileName} typed native profile lookup`);
    assert.deepEqual(resolved.values, [row.id], `${profileName} is selected by the native typed lookup`);
  }
  function finishQueuedTolnaIntro(player) {
    const intro = '[queue,soulbane_tolna_intro]';
    const queued = () => [...player.queue.all()].filter(request => request.script.name === intro);
    assert.equal(queued().length, 1, 'native forward exit queues the intro once');
    for (let boundary = 0; boundary < 256; boundary++) {
      const state = player.activeScript;
      if (!state) {
        if (queued().length === 0) break;
        rt.World.currentTick++;
        player.processQueues();
        continue;
      }
      if (state.execution === rt.State.PAUSEBUTTON) {
        assert(resumePauseButtonHandler.handle(new ResumePauseButton(0), player), 'native Continue resumes the Tolna intro');
        continue;
      }
      if (state.execution === rt.State.SUSPENDED) {
        rt.World.currentTick = Math.max(rt.World.currentTick + 1, player.delayedUntil);
        player.delayed = false;
        player.executeScript(state, true, true);
        continue;
      }
      assert.fail(`native Tolna intro stopped at execution state ${state.execution}`);
    }
    assert.equal(player.activeScript, null, 'native Tolna intro continuation completes');
    assert.equal(queued().length, 0, 'native Tolna intro queue drains');
  }
  function advanceTolnaIntro(f, route, primary, createdInstances, regionCountBefore) {
    assert.equal(route.prelude, 'soulbane-tolna-intro', 'known native Tolna route prelude');
    const stage = rt.id(rt.configs.VarBitType, 'soulbane_prog');
    assert.equal(f.player.getVarBit(stage), 9, 'the disclosed prerequisite enters the native final-hole boundary');
    const transition = rt.run('[oploc1,soul_bane_hwall_void_exit]', f);
    assert.equal(transition.state.execution, rt.State.FINISHED, 'compiled stage-9 forward-hole handler runs');
    assert.equal(f.player.getVarBit(stage), 10, 'native forward-hole handler writes the intro stage');
    const arena = rt.World.instances.findInstanceByCoord(f.player);
    assert(arena, 'native forward-hole handler enters the final arena instance');
    assert.notEqual(arena, primary, 'native forward-hole handler replaces the primary instance');
    createdInstances.push(arena);
    assert(!rt.World.instances.instances.includes(primary), 'native forward-hole replacement tears down the primary instance');
    assert(rt.World.instances.instances.includes(arena), 'the final arena remains live for its native intro');
    assert.equal(rt.World.instances.instances.length, regionCountBefore + 1, 'native replacement retains one route region');

    const instanceVar = rt.id(VarPlayerType, 'soulbane_instance');
    const owner = rt.id(VarNpcType, 'npc_attacking_uid');
    const marker = rt.id(VarNpcType, 'npc_int');
    const handle = f.player.getVar(instanceVar);
    assert.equal(handle, arena.uid + 1, 'native final arena publishes its one-based owner handle');
    const heads = new Map();
    for (const [profile, expected] of Object.entries(tolnaProfiles)) {
      const type = rt.id(NpcType, expected.head);
      const matches = [...rt.World.npcs].filter(npc => npc.isActive && npc.type === type
        && (npc.getVar(owner) >>> 0) === f.player.uid
        && npc.getVar(marker) === handle
        && rt.World.instances.findInstanceByCoord(npc) === arena);
      assert.equal(matches.length, 1, `${expected.head} is spawned once and owner-bound in the final arena`);
      heads.set(expected.head, matches[0]);
      assertTolnaSourceProfile(f, matches[0], profile);
    }
    const branaType = rt.id(NpcType, 'soulbane_brana');
    const brana = [...rt.World.npcs].filter(npc => npc.isActive && npc.type === branaType
      && (npc.getVar(owner) >>> 0) === f.player.uid
      && npc.getVar(marker) === handle
      && rt.World.instances.findInstanceByCoord(npc) === arena);
    assert.equal(brana.length, 1, 'native intro Brana is spawned and owner-bound in the final arena');

    finishQueuedTolnaIntro(f.player);
    assert.equal(f.player.getVarBit(stage), 11, 'native intro continuations activate the actual fight');
    assert.equal(f.player.getVarBit(rt.id(rt.configs.VarBitType, 'soulbane_final_seencut')), 1, 'native intro records its own scene completion');
    const aggressivePlayer = rt.id(VarNpcType, 'npc_aggressive_player');
    for (const head of heads.values()) assert.equal(head.getVar(aggressivePlayer) >>> 0, f.player.uid, 'native intro starts each actual head');

    assert.equal(route.profile, Object.keys(tolnaProfiles).find(profile => tolnaProfiles[profile].head === route.npc), `${route.script} selects its source profile`);
    assert.equal(route.stand, route.style, `${route.script} uses its declared combat stand`);
    const head = heads.get(route.npc);
    assert(head, `${route.script} selects a native spawned head`);
    f.npc = head;
    assert.equal(head.width, 3, `${route.npc} retains its source 3-tile width`);
    assert.equal(head.length, 3, `${route.npc} retains its source 3-tile length`);
    const stand = route.stand === 'melee'
      ? { x: head.x, z: head.z - 1 }
      : { x: f.player.x, z: f.player.z };
    assert(['melee', 'ranged'].includes(route.stand), `${route.script} selects a supported declared stand`);
    const tile = (head.level << 28) | (stand.x << 14) | stand.z;
    const moved = rt.run('[proc,p_telejump_safe]', f, [tile]);
    assert.equal(moved.state.execution, rt.State.FINISHED, `${route.script} places the player on its declared combat stand`);
    assert.deepEqual([f.player.level, f.player.x, f.player.z], [head.level, stand.x, stand.z], `${route.script} reaches the exact declared combat stand`);
    const inMeleeRange = rt.run('[proc,soulbane_tolna_melee_range]', f);
    assert.equal(inMeleeRange.state.execution, rt.State.FINISHED, `${route.script} evaluates the native melee predicate`);
    assert.deepEqual(inMeleeRange.values, [Number(route.style === 'melee')], `${route.script} stand selects the intended native style`);
  }
  function assertTolnaRouteStyle(result, route, branch) {
    const visited = new Set(result.visited);
    assert(visited.has('[proc,soulbane_tolna_npc_attack]'), `${route.script} enters the native head attack`);
    if (route.style === 'melee') {
      assert(visited.has('[proc,npc_default_attack]'), `${route.script} uses native melee attack`);
      assert(visited.has('[proc,npc_meleeattack]'), `${route.script} uses the native npc_meleeattack resolver`);
      assert(!visited.has('[proc,soulbane_tolna_ranged]'), `${route.script} does not fall through to Ranged`);
      return;
    }
    assert(visited.has('[proc,soulbane_tolna_ranged]'), `${route.script} uses the native Tolna Ranged path`);
    assert(visited.has('[proc,npc_ranged_attack_roll]'), `${route.script} uses native Ranged accuracy`);
    assert(visited.has('[proc,player_defence_roll_specific]'), `${route.script} uses native style-specific defence`);
    const rolls = result.events.filter(event => event.op === 'RANDOMINC');
    assert.equal(rolls.length, branch === 'miss' ? 2 : 3, `${route.script} retains the native accuracy and damage draws`);
    if (branch !== 'miss') assert.equal(rolls[2].in[0], 5, `${route.script} retains the native five-point Ranged maximum`);
  }
  function runNativePlayerTrigger(name, f, values) {
    const script = rt.Provider.getByName(name);
    assert(script, `packed native player trigger ${name}`);
    const state = ScriptRunner.init(script, f.player, f.npc);
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    const originalRandom = JavaRandom.nextDouble;
    let cursor = 0;
    JavaRandom.nextDouble = () => {
      assert(cursor < values.length, `${name}: no unplanned random draws`);
      return values[cursor++];
    };
    try { f.player.executeScript(state, true, true); }
    finally { JavaRandom.nextDouble = originalRandom; }
    assert.equal(state.execution, rt.State.FINISHED, `${name} finishes as a native player attack`);
    assert.equal(cursor, values.length, `${name} consumes the expected native attack draws`);
    return state;
  }
  function pumpTolnaNpcQueues(f, head, complete, limit = 64) {
    const originalRandom = JavaRandom.nextDouble;
    const originalMathRandom = Math.random;
    JavaRandom.nextDouble = () => 0;
    Math.random = () => 0;
    try {
      for (let tick = 0; tick < limit; tick++) {
        rt.World.processNpcEventQueue();
        if (head.isActive) head.turn();
        f.player.processQueues();
        if (complete()) return;
        rt.World.currentTick++;
      }
      assert(complete(), 'native Tolna queue drains within its ordinary event boundaries');
    } finally {
      JavaRandom.nextDouble = originalRandom;
      Math.random = originalMathRandom;
    }
  }
  function exerciseTolnaNativePoison(f, route) {
    const instance = rt.World.instances.findInstanceByCoord(f.player);
    assert(instance, 'native poison fixture remains in its actual arena');
    const owner = rt.id(VarNpcType, 'npc_attacking_uid');
    const marker = rt.id(VarNpcType, 'npc_int');
    const handle = f.player.getVar(rt.id(VarPlayerType, 'soulbane_instance'));
    const heads = [...rt.World.npcs].filter(npc => npc.isActive
      && Object.values(tolnaProfiles).some(profile => npc.type === rt.id(NpcType, profile.head))
      && (npc.getVar(owner) >>> 0) === f.player.uid
      && npc.getVar(marker) === handle
      && rt.World.instances.findInstanceByCoord(npc) === instance);
    assert.equal(heads.length, 3, 'native poison fixture retains all three actual heads');
    const head = heads.find(npc => npc.type === rt.id(NpcType, route.npc));
    assert(head, 'native melee target is one of the actual spawned heads');
    assert.equal(f.npc, head, 'native player trigger targets the route-selected head');

    const weapon = rt.configs.ObjType.getByName('rune_dagger_p');
    assert(weapon, 'packed poisonous Rune dagger');
    const severity = rt.param(weapon, 'poison_severity');
    assert(severity > 0, 'packed weapon has native poison severity');
    const worn = rt.id(rt.configs.InvType, 'worn');
    f.player.invSet(worn, weapon.id, 1, weapon.wearpos);
    assert.equal(f.player.invGetSlot(worn, weapon.wearpos)?.id, weapon.id, 'fixture equips the real poisoned melee weapon');
    rt.run('[proc,player_combat_stat]', f);

    const poison = rt.id(VarNpcType, 'npc_poison');
    const hpBefore = new Map(heads.map(npc => [npc, npc.levels[3]]));
    assert.equal(head.getVar(poison), 0, 'native poison starts absent on the actual target');
    assert.equal(head.levels[3], 37, 'actual target keeps source HP until its ordinary queued hit');
    const trigger = `[opnpc2,${route.npc}]`;
    runNativePlayerTrigger(trigger, f, [0.999999, 0, 0.999999, 0]);
    const damageQueue = [...head.queue.all()].filter(request => request.queueId === ServerTriggerType.AI_QUEUE2);
    assert.equal(damageQueue.length, 1, 'real player attack queues exactly one native AI_QUEUE2 damage input');
    assert(damageQueue[0].lastInt > 0, 'real player attack queues positive damage');
    assert.equal(head.getVar(poison), severity, 'real weapon poison enters through native npc_poison_start');

    const poisonQueueName = '[queue,soulbane_tolna_poison]';
    const poisonRequests = () => [...f.player.queue.all()].filter(request => request.script.name === poisonQueueName);
    const originalRandom = JavaRandom.nextDouble;
    const originalMathRandom = Math.random;
    JavaRandom.nextDouble = () => 0;
    Math.random = () => 0;
    try {
      let queued = false;
      for (let tick = 0; tick < 32 && !queued; tick++) {
        rt.World.processNpcEventQueue();
        if (head.isActive) head.turn();
        queued = poisonRequests().length > 0;
        if (!queued) rt.World.currentTick++;
      }
      assert.equal(poisonRequests().length, 1, 'native AI_QUEUE2 damage hands poison to the owner player queue');
      assert(head.levels[3] < hpBefore.get(head), 'native queued damage reduces the actual head HP');
      f.player.processQueues();
      assert.equal(poisonRequests().length, 0, 'native owner poison queue drains');
    } finally {
      JavaRandom.nextDouble = originalRandom;
      Math.random = originalMathRandom;
    }
    for (const npc of heads) {
      assert.equal(npc.getVar(poison), severity, 'native owner queue poisons every live owner-bound head');
      assert.equal(npc.timerInterval, 30, 'native poison uses the published NPC timer');
    }
    for (const npc of heads.filter(actor => actor !== head)) {
      assert.equal(npc.levels[3], hpBefore.get(npc), 'poison admission does not directly alter a second head HP');
    }

    const poisonDamage = Math.floor((severity - 1 + 4) / 5);
    for (const npc of heads) {
      const before = npc.levels[3];
      const ticksUntilTimer = Math.max(1, npc.timerInterval - npc.timerClock);
      const timerRandom = JavaRandom.nextDouble;
      const timerMathRandom = Math.random;
      JavaRandom.nextDouble = () => 0;
      Math.random = () => 0;
      try {
        for (let tick = 0; tick < ticksUntilTimer; tick++) {
          rt.World.currentTick++;
          rt.World.processNpcEventQueue();
          npc.turn();
          f.player.processQueues();
        }
      } finally {
        JavaRandom.nextDouble = timerRandom;
        Math.random = timerMathRandom;
      }
      assert.equal(npc.getVar(poison), severity - 1, 'native poison timer decrements its own status');
      assert.equal(npc.levels[3], before - poisonDamage, 'native poison timer applies its ordinary damage');
    }

    const stage = rt.id(rt.configs.VarBitType, 'soulbane_prog');
    const deathBit = rt.id(rt.configs.VarBitType, 'soulbane_final_tol1dead');
    assert.equal(f.player.getVarBit(stage), 11, 'native combat remains active before the queued death input');
    assert.equal(f.player.getVarBit(deathBit), 0, 'native death credit starts unset');
    head.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, head.levels[3]);
    pumpTolnaNpcQueues(f, head, () => f.player.getVarBit(deathBit) === 1);
    assert.equal(head.levels[3], 0, 'native queued damage actually kills the selected head');
    assert.equal(f.player.getVarBit(deathBit), 1, 'native death queue records only its own head');
    for (const name of ['soulbane_final_tol2dead', 'soulbane_final_tol3dead']) {
      assert.equal(f.player.getVarBit(rt.id(rt.configs.VarBitType, name)), 0, 'native death does not credit another head');
    }
    assert.equal(f.player.getVarBit(stage), 11, 'one native death does not clear the fight');
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
    const style = route.style ?? 'melee';
    const nativeTolna = route.prelude === 'soulbane-tolna-intro';
    for (const [branch, preferredSeed] of Object.entries(route.seeds)) {
      let attempts = 0;
      const outcomes = [];
      const probe = seed => {
        const result = execute(pack, route.npc, route.script, [], 'seeded', style,
          f => configureRoute(f, route), route.distance ?? 1, { seed },
          nativeTolna ? 'cow' : route.npc, false);
        attempts++;
        assert.deepEqual(result.errors, [], `${route.script} seed=${seed}: script diagnostics`);
        assert.equal(result.snapshot.error, null, `${route.script} seed=${seed}: script execution error`);
        assert.equal(result.settled.error, null, `${route.script} seed=${seed}: settled script execution error`);
        assert.notEqual(result.snapshot.execution, rt.State.ABORTED, `${route.script} seed=${seed}: native route abort`);
        const actualBranch = dispatchBranch(result);
        outcomes.push(`${seed}:${actualBranch}`);
        return { seed, result, actualBranch };
      };
      let selected = probe(preferredSeed);
      if (selected.actualBranch !== branch) {
        for (let index = 1; index <= MAX_ROUTE_SEED_FALLBACK_ATTEMPTS; index++) {
          const seed = Math.imul(index, ROUTE_SEED_MULTIPLIER) >>> 0;
          if (seed === preferredSeed) continue;
          const candidate = probe(seed);
          if (candidate.actualBranch === branch) {
            selected = candidate;
            break;
          }
        }
      }
      assert.equal(selected.actualBranch, branch,
        `${route.script} npc=${route.npc} branch=${branch}: no native branch after ${attempts} attempts; preferred seed=${preferredSeed}; observed ${outcomes.join(', ')}`);
      const seedMetadata = { seed: selected.seed, preferredSeed, seedAttempts: attempts };
      check(`${route.script} seeded ${branch} seed=${selected.seed} attempts=${attempts}`, () => {
        const result = differential(route.npc, route.script, [], 'seeded', style,
          { routeBranch: branch, ...seedMetadata, profile: route.profile, stand: route.stand },
          f => configureRoute(f, route), route.distance ?? 1, { seed: selected.seed }, !nativeTolna,
          nativeTolna ? 'cow' : route.npc, selected.result);
        assert.equal(dispatchBranch(result), branch, `${route.script} seed=${selected.seed} attempts=${attempts}`);
        if (nativeTolna) assertTolnaRouteStyle(result, route, branch);
        for (const record of npcs) {
          if (record.npc === route.npc || !record.entries.some(entry => entry.script === route.script)) continue;
          execute(pack, record.npc, route.script, [], 'seeded', style,
            f => configureRoute(f, { ...route, npc: record.npc }), route.distance ?? 1, { seed: selected.seed });
        }
        branches.push({
          branch, ...seedMetadata, accuracy: result.accuracy,
          queued: result.snapshot.queued, error: result.snapshot.error
        });
      });
    }
    report.routeCoverage.push({ script: route.script, npc: route.npc, style, profile: route.profile, stand: route.stand, branches, unsupportedBranches: route.unsupportedBranches ?? {} });
  }
  // Read distance predicates, not guesses about an NPC's style. These are the
  // near/far classes in each reachable production block. Dessous also divides
  // the distant class at chase_distance=5. Timers/player attack handlers are
  // outside this native NPC attack census.
  const distanceClasses = new Map([
    ['[ai_applayer2,king_dragon]', [1, 2]],
    ['[label,dragon_ai_applayer2]', [1, 2]],
    ['[ai_applayer2,kalphite_queen]', [1, 2]],
    ['[ai_applayer2,kalphite_flyingqueen]', [1, 2]],
    ['[ai_applayer2,_macro_event_rock_golem]', [1, 2]],
    ['[ai_applayer2,nezikchened]', [1, 2]],
    ['[proc,wyvern_attack_style]', [1, 2]],
    ['[proc,zygomite_attack_style]', [1, 2]],
    ['[proc,killerwatt_attack_style]', [1, 2]], // killerwatt_melee_distance=1
    ['[proc,dt_kamil_attack]', [1, 2]], // dt_ice_kamil_adjacent_radius=1
    ['[proc,dt_dessous_attack]', [1, 2, 5, 6]],
    ['[proc,soulbane_hope_npc_attack]', [1, 2]],
    ['[proc,soulbane_tolna_melee_range]', [1, 2]] // cardinal edge / outside it
  ]);
  function attackClosure(name, seen = new Set()) {
    if (seen.has(name)) return seen;
    seen.add(name);
    for (const target of inventory.edges.get(name) ?? []) attackClosure(target, seen);
    return seen;
  }
  census.distanceCoverage = [];
  for (const record of npcs) {
    const type = NpcType.getByName(record.npc);
    const entries = [...record.entries];
    // Some AP bodies (notably KBD's far fire) reach no watched shared segment,
    // although the type's OP body does. Resolve them natively, too.
    const ap = rt.Provider.getByTrigger(ServerTriggerType.AI_APPLAYER2, type.id, type.category);
    if (ap && !entries.some(entry => entry.script === ap.name)) {
      entries.push({ script: ap.name, trigger: 'AI_APPLAYER2' });
    }
    for (const entry of entries) {
      const closure = attackClosure(entry.script);
      const distances = new Set([1]);
      if (entry.trigger === 'AI_APPLAYER2') distances.add(type.attackrange);
      for (const name of closure) for (const distance of distanceClasses.get(name) ?? []) distances.add(distance);
      const route = routeSeeds.routes.find(route => route.script === entry.script)
        ?? routeSeeds.routes.find(route => record.entries.some(entry => entry.script === route.script));
      assert(route, `${record.npc} has a disclosed route fixture`);
      const streams = report.routeCoverage.find(route => route.script === entry.script)?.branches.map(branch => branch.seed)
        ?? Object.values(route.seeds);
      const profile = { ...route, npc: record.npc };
      const style = route.style ?? 'melee';
      for (const distance of [...distances].sort((a, b) => a - b)) {
        assert(Number.isInteger(distance) && distance >= 0, `${record.npc} attack distance ${distance}`);
        const prepare = f => {
          const cleanup = configureRoute(f, profile);
          try {
            // Disclosed actor-position fixture, after any native private-region
            // prelude. Native teleport maintains zone presence and also places
            // the dead-player negative control, unlike p_telejump_safe.
            f.player.teleport(f.npc.x - distance, f.npc.z, f.npc.level);
            assert.deepEqual([f.player.level, f.player.x, f.player.z],
              [f.npc.level, f.npc.x - distance, f.npc.z],
              `${record.npc} reaches native edge distance ${distance}`);
            if (distance > 1 && closure.has('[proc,soulbane_hope_npc_attack]')) {
              f.npc.setVar(rt.id(VarNpcType, 'soulbane_hope_melee_until'), rt.World.currentTick);
            }
            return cleanup;
          } catch (error) { cleanup?.(); throw error; }
        };
        // Private native life/intro preludes require living actors. Apply each
        // negative-control state only after that prelude has produced them.
        for (const variant of variants) execute(pack, record.npc, entry.script, [], variant, style,
          prepare, distance, null, route.prelude === 'soulbane-tolna-intro' ? 'cow' : record.npc, true, true);
        for (const seed of streams) execute(pack, record.npc, entry.script, [], 'seeded', style,
          prepare, distance, { seed }, route.prelude === 'soulbane-tolna-intro' ? 'cow' : record.npc, true, true);
        census.distanceCoverage.push({ npc: record.npc, script: entry.script, distance, attackrange: type.attackrange });
      }
    }
  }
  console.log(`PRESENTATION_CENSUS distanceCases=${census.distanceCoverage.length}`);
  for (const name of ['confuse', 'weaken', 'curse']) for (const variant of ['hit', 'miss']) {
    check(`standard NPC ${name} ${variant} has no damage hitmark`, () => {
      const row = rt.spell(name);
      assert.equal(rt.field(row, 'maxhit'), -1, 'absent maximum is null');
      const result = execute(pack, 'bearded_dark_wizard', '[proc,npc_cast_spell]',
        [spellId(row), 4], variant, 'magic');
      assert.equal(result.snapshot.execution, rt.State.FINISHED);
      assert.deepEqual(result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]'), []);
      assert(!result.settled.events.some(event => event.op === 'DAMAGE'), 'no hitmark opcode');
      assert(result.visited.includes(`[proc,npc_spell_${variant === 'hit' ? 'success' : 'fail'}]`));
    });
  }
  for (const npc of ['invrigar_the_necromancer', 'necromancer']) {
    for (const trigger of ['ai_opplayer2', 'ai_applayer2']) {
      const script = `[${trigger},${npc}]`;
      check(`${script} curses Defence after Attack and Strength are drained`, () => {
        const route = routeSeeds.routes.find(route => route.script === script);
        let before;
        const result = differential(npc, script, [], 'seeded', 'magic', {}, f => {
          configureRoute(f, route);
          f.player.levels[0]--;
          f.player.levels[2]--;
          before = [...f.player.levels];
        }, 1, { draws: [0.25, 0.999999, 0] }, false);
        assert.equal(result.snapshot.execution, rt.State.FINISHED);
        assert.deepEqual(result.errors, []);
        assert(result.visited.includes('[proc,npc_stat_change_effect]'), 'native curse drains');
        assert.equal(result.snapshot.levels[0], before[0], 'Attack stays drained');
        assert.equal(result.snapshot.levels[2], before[2], 'Strength stays drained');
        assert(result.snapshot.levels[1] < before[1], 'Defence drains from base');
        assert.deepEqual(result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]'), [],
          'Curse queues no Water Bolt damage');
        assert.equal(result.settled.levels[3], before[3]);
        assert(!result.settled.events.some(event => event.op === 'DAMAGE'), 'no damage hitmark');
      });
    }
  }
  const rotRoute = routeSeeds.routes.find(route => route.npc === 'skeletonmage');
  for (const [branch, seed] of Object.entries(rotRoute.rotSeeds)) {
    check(`skeletonmage native rot ${branch}`, () => {
      let before, clock;
      const result = differential(rotRoute.npc, rotRoute.script, [], 'seeded', 'magic',
        { rotBranch: branch, seed }, f => {
          configureRoute(f, rotRoute);
          before = [...f.player.levels];
          clock = rt.World.currentTick;
        }, 1, { seed }, false);
      assert.equal(result.snapshot.execution, rt.State.FINISHED);
      assert(result.visited.includes('[proc,npc_spell_cast]'), 'the native rot branch casts');
      assert.deepEqual(result.accuracy, [branch === 'landed']);
      for (const stat of [0, 1, 2]) {
        assert.equal(result.snapshot.levels[stat], before[stat] - (branch === 'landed' ? 4 : 0));
      }
      assert.equal(result.settled.levels[3], before[3], 'rot deals no damage');
      assert.deepEqual(result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]'), [],
        'rot queues no damage hit, including a zero hit');
      assert(!result.settled.events.some(event => event.op === 'DAMAGE'), 'rot draws no hitmark');
      if (branch === 'failed') {
        assert(result.visited.includes('[proc,npc_spell_fail]'), 'standard curse failure path');
        const splash = result.events.filter(event => event.op === 'SPOTANIM_PL');
        assert.equal(splash.length, 1, 'one failure splash');
        assert(splash[0].in.includes(rt.id(rt.configs.SpotanimType, 'failedspell_impact')));
      }
      assert.equal(result.snapshot.npcVars[rt.id(VarNpcType, 'npc_action_delay')], clock + 4);
    });
  }
  for (const stat of [0, 1, 2]) check(`skeletonmage declines rot below base stat=${stat}`, () => {
    const result = differential(rotRoute.npc, rotRoute.script, [], 'seeded', 'magic',
      { belowBaseStat: stat, seed: rotRoute.rotSeeds.landed }, f => {
        configureRoute(f, rotRoute);
        f.player.levels[stat]--;
      }, 1, { seed: rotRoute.rotSeeds.landed }, false);
    assert.equal(result.snapshot.execution, rt.State.FINISHED);
    assert(!result.visited.includes('[proc,npc_spell_cast]'), 'rot is not cast');
    assert(result.visited.includes('[proc,npc_default_attack]'), 'ordinary melee is retained');
    assert(!result.events.some(event => event.op === 'STAT_SUB'), 'no drain is applied');
  });
  const neziRoute = routeSeeds.routes.find(route => route.script === '[ai_applayer2,nezikchened]');
  for (const branch of ['hit', 'zero', 'miss', 'protected']) {
    check(`nezikchened native distance-two magic ${branch}`, () => {
      const seed = neziRoute.seeds[branch === 'protected' ? 'hit' : branch];
      let clock, hp;
      const result = differential(neziRoute.npc, neziRoute.script, [],
        branch === 'protected' ? 'protected-hit' : 'seeded', 'magic',
        { nativeSpellBranch: branch, seed, distance: 2 }, f => {
          configureRoute(f, neziRoute);
          clock = rt.World.currentTick;
          hp = f.player.levels[3];
        }, 2, { seed }, false);
      assert.equal(result.snapshot.execution, rt.State.FINISHED);
      assert(result.visited.includes('[proc,npc_spell_cast]'), 'native magic-distance branch casts');
      assert.equal(result.snapshot.npcVars[rt.id(VarNpcType, 'npc_action_delay')], clock + 5);
      assert.equal(dispatchBranch(result), branch === 'protected' ? 'miss' : branch);
      const hits = result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]');
      if (branch === 'hit' || branch === 'zero') {
        assert.equal(hits.length, 1);
        assert(hits[0].args[0] >= 0 && hits[0].args[0] <= 18);
        assert.equal(result.settled.levels[3], hp - hits[0].args[0]);
        const magnitude = result.events.filter(event => event.op === 'RANDOMINC').at(-1);
        assert.equal(magnitude.in[0], 18, 'dedicated magic maximum');
      } else {
        assert.deepEqual(hits, []);
        assert.equal(result.settled.levels[3], hp, 'miss or protection deals no damage');
      }
    });
  }
  census.aborts = census.cases.filter(result => result.execution === rt.State.ABORTED || result.error || result.settledError || result.diagnostics.length);
  check('every packed native attack route branch has no script error', () => assert.deepEqual(census.aborts, []));
  check('Tolna native route manifest covers the five source styles', () => {
    const tolnaRoutes = routeSeeds.routes.filter(route => route.prelude === 'soulbane-tolna-intro');
    const expected = {
      soulbane_final_tolna1: ['melee', 'ranged'],
      soulbane_final_tolna2: ['ranged'],
      soulbane_final_tolna3: ['melee', 'ranged']
    };
    assert.equal(tolnaRoutes.length, 6, 'both native player attack triggers are registered for each head');
    for (const [head, styles] of Object.entries(expected)) {
      const routes = tolnaRoutes.filter(route => route.npc === head);
      assert.deepEqual([...new Set(routes.map(route => route.style))].sort(), [...styles].sort(), `${head} retains only its source-backed styles`);
      assert.deepEqual(routes.map(route => route.script).sort(), [`[ai_applayer2,${head}]`, `[ai_opplayer2,${head}]`], `${head} covers both native dispatch triggers`);
      for (const route of routes) assert.equal(route.stand, route.style, `${route.script} pairs its production style with its disclosed stand`);
    }
  });
  const poisonRoute = routeSeeds.routes.find(route => route.npc === 'soulbane_final_tolna1' && route.style === 'melee');
  assert(poisonRoute, 'native South melee route anchors the ordinary poison fixture');
  check('Tolna ordinary queued hit shares native poison and retains HP/death', () => {
    rt.select(pack);
    const f = rt.fixture('cow', 'seeded', 'melee');
    let cleanup;
    try {
      cleanup = configureRoute(f, poisonRoute);
      exerciseTolnaNativePoison(f, poisonRoute);
    } finally {
      try { cleanup?.(); }
      finally { rt.dispose(); }
    }
  });
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
  const seededBranches = report.routeCoverage.flatMap(route => route.branches.map(branch => ({
    script: route.script, npc: route.npc, branch: branch.branch, attempts: branch.seedAttempts
  })));
  const maxSeedAttempts = Math.max(0, ...seededBranches.map(branch => branch.attempts));
  const retriedBranches = seededBranches.filter(branch => branch.attempts > 1);
  for (const branch of retriedBranches) console.log(`SEED_SEARCH ${branch.script} npc=${branch.npc} branch=${branch.branch} attempts=${branch.attempts}`);
  console.log(`SEED_SEARCH_SUMMARY retriedBranches=${retriedBranches.length} maxAttempts=${maxSeedAttempts}`);
  report.routeSeedSearch.maxAttempts = maxSeedAttempts;
  report.routeSeedSearch.retriedBranches = retriedBranches;
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
