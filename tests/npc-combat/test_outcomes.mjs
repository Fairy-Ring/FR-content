#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
const watched = ['npc_default_attack', 'npc_meleeattack', 'npc_rangeattack', 'npc_cast_spell', 'npc_cast_spell_with_forced_max_hit', 'npc_spell_success', 'playerhit_n_melee', 'playerhit_n_ranged', 'npc_player_hit_roll', 'npc_spell_cast', 'npc_combat_spell_checks', 'npc_freeze_allowed', 'npc_debuff_allowed', 'npc_spell_fail', 'npc_stat_change_effect', 'npc_freeze_effect'];
const variants = ['hit', 'zero', 'miss', 'protected-hit', 'protected-zero', 'protected-miss', 'pending', 'target-loss'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const effects = result => ({ snapshot: result.snapshot, settled: result.settled, events: result.events.filter(e => /QUEUE|ANIM|SOUND|^MES|DAMAGE|SETMODE|STAT_(ADD|SUB)|^IF_CLOSE|^RUNENERGY/.test(e.op)), draws: result.draws, randomSources: result.randomSources });
let checks = 0;
function check(label, action) { action(); checks++; console.log(`PASS ${label}`); }
function same(actual, expected, label, full = false) {
  assert.deepEqual(effects(actual), effects(expected), label);
  if (full) assert.deepEqual(actual.events, expected.events, `${label}: ordered reads, computations and effects`);
}
const temporary = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'npc-outcomes-'));
const report = { schema: 1, callerManifest: registered.policy, basePack: Boolean(base), cases: [], costs: [], externalCallers: {}, observedCallers: [], summary: {} };
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
  function execute(directory, type, name, args, variant, style, configure = null, distance = 1) {
    rt.select(directory);
    const f = rt.fixture(type, variant, style, distance);
    try {
      if (configure) configure(f);
      const actualArgs = typeof args === 'function' ? args(f) : args;
      const result = rt.observe(name, f, actualArgs, variant);
      result.settled = rt.settle(f);
      for (const caller of result.visited) observed.add(caller);
      return result;
    } finally { rt.dispose(); }
  }
  function maximum(style, f) { return rt.run(`[proc,npc_${style === 'melee' ? 'melee' : 'ranged'}_maxhit]`, f).values[0]; }
  function cost(before, after, metadata) {
    const added = Object.fromEntries([...new Set([...Object.keys(before.commands), ...Object.keys(after.commands)])].map(op => [op, (after.commands[op] ?? 0) - (before.commands[op] ?? 0)]).filter(([, count]) => count));
    report.costs.push({ ...metadata, before: before.opcount, after: after.opcount, added });
  }
  function differential(type, name, args, variant, style, metadata = {}) {
    const head = execute(pack, type, name, args, variant, style);
    if (base) {
      const before = execute(base, type, name, args, variant, style);
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
        return style === 'melee' ? [maxhit, 0, 0] : style === 'ranged' ? [maxhit, 0, 0] : [spellId(wind), 4, -1, 0];
      };
      const explicit = execute(pack, record.npc, `[proc,${style === 'melee' ? 'npc_default_attack' : style === 'ranged' ? 'npc_rangeattack' : 'npc_cast_spell'}_outcome]`, outcomeArgs, variant, style);
      same(explicit, head, `${record.npc} ${style} ${variant} explicit-prefix drift`);
      delivery(explicit, style, maxhit);
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
  check('typed queue references use compiled names after pack regeneration', () => {
    const result = execute(pack, 'cow', '[proc,npc_default_attack]', [], 'hit', 'melee');
    const queues = result.events.filter(event => event.op === 'QUEUE' || event.op === 'QUEUE*');
    assert(queues.length > 0);
    for (const event of queues) assert.match(event.in.at(-1), /^\[queue,/);
  });
  for (const [style, type] of [['melee', 'cow'], ['ranged', 'ardougne_archer'], ['magic', 'bearded_dark_wizard']]) {
    const entry = `[proc,bc00_test_${style}]`;
    const args = style === 'melee' ? [7, 2, 0] : style === 'ranged' ? [7, 0, 0] : [spellId(wind), 4, 7, 0];
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
    for (const level of [30, 80]) {
      const prepare = f => { f.player.levels[1] = level; f.player.baseLevels[1] = level; rt.run('[proc,player_combat_stat]', f); };
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
    const native = execute(pack, 'bearded_dark_wizard', '[proc,npc_cast_spell_outcome]', [spellId(row), 4, -1, 0], variant, 'magic');
    const latent = execute(pack, 'bearded_dark_wizard', '[proc,npc_cast_spell_outcome]', [spellId(row), 4, -1, 1], variant, 'magic');
    assert.deepEqual(latent.snapshot, native.snapshot); assert.deepEqual(latent.settled, native.settled);
    assert.equal(latent.events.filter(e => e.op === 'SPOTANIM_PL').length, 1, 'exactly the native failed impact');
    assert.equal(latent.snapshot.queued.filter(q => q.script === '[queue,npc_freeze_player]').length, 0);
    assert.equal(latent.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]').length, 0);
    assert.deepEqual(latent.values.slice(0, 2), [1, variant.endsWith('miss') ? 0 : 1]);
    assert.equal(latent.values[3], 0); assert.equal(latent.draws.length, variant.endsWith('miss') ? 2 : 3);
  });
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
  report.summary = { checks, npcTypes: npcs.length, routes: npcs.reduce((n, r) => n + r.entries.length, 0), differentialCases: report.costs.length, passed: true };
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
