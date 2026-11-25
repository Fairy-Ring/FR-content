#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseOptions, resolveRoots, run } from './packed.mjs';
import { runtime } from '../npc-combat/outcome_runtime.mjs';

await run(async () => {
  const { engineRoot, packDir } = resolveRoots(parseOptions());
  const rt = await runtime(engineRoot, packDir);
  const load = file => import(pathToFileURL(path.join(engineRoot, file)).href);
  const [{ default: Trigger }, { default: Player }, routefinder, { EntityLifeCycle }] = await Promise.all([
    load('src/engine/script/ServerTriggerType.ts'), load('src/engine/entity/Player.ts'),
    load('src/engine/routefinder/index.ts'), load('src/engine/entity/EntityLifeCycle.ts')
  ]);
  const { World, Provider, State, Pointer, configs: { NpcType, VarNpcType, VarPlayerType } } = rt;
  const nv = name => rt.id(VarNpcType, name), pv = name => rt.id(VarPlayerType, name);
  const type = NpcType.getByName('barrows_torag');
  const attack = Provider.getByTrigger(Trigger.AI_OPPLAYER2, type.id, type.category);
  const damage = result => result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]');
  const corruption = result => result.snapshot.queued.filter(q => q.script === '[queue,barrows_torag_corruption]');
  let checks = 0;
  const check = (label, body) => { body(); checks++; console.log(`PASS BC-03 ${label}`); };
  const fixture = (variant = 'hit') => { rt.dispose(); return rt.fixture('barrows_torag', variant); };
  const observe = (f, draws = [0.999999, 0, 0.999999, 0]) => {
    const result = rt.observe(attack.name, f, [], 'seeded', { draws });
    assert.equal(result.snapshot.execution, State.FINISHED);
    assert.equal(result.snapshot.error, null);
    assert.deepEqual(result.errors, []);
    assert(result.snapshot.pointers & (1 << Pointer.ActivePlayer));
    assert.equal(result.snapshot.playerProtected, false);
    return result;
  };
  const settle = (f, ticks = 6) => {
    const result = rt.settle(f, ticks);
    assert.equal(result.error, null);
    return result;
  };
  try {
    check('packed field group, original identity, unchanged owned bindings and native defaults', () => {
      assert.equal(type.id, 2029);
      assert.equal(type.vislevel, 115);
      assert.deepEqual([...type.stats], [100, 100, 100, 100, 1, 1]);
      assert.equal(type.regenrate, 16);
      for (const [field, value] of Object.entries({ attackrange: 0, huntmode: -1, huntrange: 0, wanderrange: 5, maxrange: 7, timer: -1 })) assert.equal(type[field], value, field);
      const selected = { attackrate: 5, damagetype: 2, attackbonus: 0, strengthbonus: 72, magicattack: -33, rangeattack: -11, rangebonus: 0,
        stabdefence: 221, slashdefence: 235, crushdefence: 222, magicdefence: 0, rangedefence: 221, barrows_maxhit: 25,
        attack_anim: rt.id(rt.configs.SeqType, 'barrow_torag_crush'), attack_sound: 1076, defend_sound: 1071, death_sound: 1072 };
      for (const [name, value] of Object.entries(selected)) {
        assert(type.params.has(rt.id(rt.configs.ParamType, name)), `present ${name}`);
        assert.equal(rt.param(type, name), value, name);
      }
      assert.equal(type.params.size, Object.keys(selected).length, 'no unselected combat or presentation params');
      assert.equal(attack.name, '[ai_opplayer2,barrows_torag]');
      for (const [trigger, name] of [[Trigger.AI_TIMER, '[ai_timer,barrows_torag]'], [Trigger.AI_QUEUE3, '[ai_queue3,barrows_torag]'], [Trigger.AI_QUEUE1, '[ai_queue1,_]']]) assert.equal(Provider.getByTrigger(trigger, type.id, type.category).name, name);
    });
    for (const strength of [1, 100, 150]) check(`explicit maximum 25 is independent of current Strength ${strength}`, () => {
      const f = fixture(); f.npc.levels[2] = strength;
      for (const [i, name] of ['com_stabdef', 'com_slashdef', 'com_crushdef'].entries()) f.player.setVar(pv(name), 113 + i * 101);
      const result = observe(f);
      assert.deepEqual(result.events.filter(e => e.op === 'RANDOMINC').map(e => e.in), [[6976], [315], [25]], 'one native accuracy pair and one explicit magnitude');
      assert.deepEqual(result.draws, [0.999999, 0, 0.999999, 0]);
      assert.deepEqual(damage(result).map(q => q.args), [[25]]);
      assert.equal(f.npc.getVar(nv('npc_action_delay')), 105);
      assert.equal(f.player.runenergy, 10000, 'effect is queued, not immediate');
      assert.equal(settle(f).levels[3], 230);
    });
    for (const [energy, expected] of [[10000, 8000], [5000, 4000], [100, 80], [1, 0], [2, 1], [5, 4], [6, 4], [0, 0], [99, 79]]) check(`current energy final floor ${energy} to ${expected}`, () => {
      const f = fixture(); f.player.runenergy = energy;
      const result = observe(f);
      assert.equal(corruption(result).length, 1);
      assert.deepEqual(corruption(result)[0].args, [f.npc.uid], 'queued immutable source');
      assert.deepEqual(result.snapshot.queued.map(q => q.script), ['[queue,combat_damage_player]', '[queue,playerhit_n_retaliate]', '[queue,barrows_torag_corruption]']);
      assert.equal(corruption(result)[0].delay, 0);
      const delivered = settle(f);
      assert.equal(delivered.energy, expected);
      assert.deepEqual(delivered.events.filter(e => e.op === 'HEALENERGY').map(e => e.in), expected - energy === -1 ? [[1], [-2]] : [[expected - energy]]);
      assert(delivered.events.findIndex(e => e.op === 'STAT_SUB') < delivered.events.findIndex(e => e.op === 'HEALENERGY'), 'native damage precedes drain');
      assert.deepEqual(delivered.messages, [], 'no invented message');
      const ordinary = fixture(); ordinary.player.runenergy = energy;
      const noProc = observe(ordinary, [0.999999, 0, 0.999999, 0.25]);
      assert.equal(corruption(noProc).length, 0);
      const ordinaryDelivered = settle(ordinary);
      const procPresentation = presentation([...result.events, ...delivered.events]);
      const noProcPresentation = presentation([...noProc.events, ...ordinaryDelivered.events]);
      const effectGraphic = event => event.op === 'SPOTANIM_PL' && event.in.at(-1) === 399;
      const effectSound = event => event.op === 'SOUND_SYNTH' && event.in.at(-1) === 1062;
      assert.deepEqual(procPresentation.filter(effectGraphic).map(event => event.in), [[0, 0, 399]]);
      assert.deepEqual(procPresentation.filter(effectSound).map(event => event.in), [[0, 0, 1062]]);
      assert.equal(noProcPresentation.filter(effectGraphic).length, 0);
      assert.equal(noProcPresentation.filter(effectSound).length, 0);
      assert.deepEqual(procPresentation.filter(event => !effectGraphic(event) && !effectSound(event)), noProcPresentation,
        'Corruption adds only its player effect and weapon-named sound');
    });
    for (const [procDraw, procs] of [[0, true], [0.249999, true], [0.25, false], [0.5, false], [0.999999, false]]) check(`one-in-four boundary draw ${procDraw}`, () => {
      const f = fixture(); const result = observe(f, [0.999999, 0, 0.999999, procDraw]);
      assert.equal(result.draws.length, 4);
      assert.deepEqual(result.events.filter(e => e.op === 'RANDOM').map(e => e.in), [[4]]);
      assert.equal(corruption(result).length, Number(procs));
      const delivered = settle(f);
      assert.equal(delivered.energy, procs ? 8000 : 10000);
      assert.equal(delivered.levels[3], 230, 'one ordinary hit regardless of proc');
    });
    for (const variant of ['miss', 'zero', 'protected-hit', 'protected-zero', 'protected-miss']) check(`${variant} accuracy and zero gate`, () => {
      const f = fixture(variant);
      const missed = variant.endsWith('miss'), zero = variant.endsWith('zero');
      const result = observe(f, missed ? [0, 0.999999] : [0.999999, 0, zero ? 0 : 0.999999, 0]);
      assert.equal(result.draws.length, missed ? 2 : 4, 'miss consumes no magnitude or proc draw');
      assert.equal(corruption(result).length, Number(!missed));
      assert.equal(damage(result).length, 1);
      const expectedDamage = variant === 'miss' || zero || variant.startsWith('protected') ? 0 : 25;
      assert.deepEqual(damage(result)[0].args, [expectedDamage]);
      const delivered = settle(f);
      assert.equal(delivered.energy, missed ? 10000 : 8000);
      assert.equal(delivered.levels[3], 255 - expectedDamage);
    });
    for (const variant of ['pending', 'target-loss', 'npc-busy', 'dead-player', 'dead-npc']) check(`${variant} cannot create a proc or hit`, () => {
      const f = fixture(variant); const result = observe(f);
      assert.equal(result.draws.length, 0);
      assert.equal(damage(result).length, 0);
      assert.equal(corruption(result).length, 0);
      assert.equal(settle(f).energy, 10000);
    });
    for (const loss of ['player-death', 'npc-death', 'removed', 'retargeted']) check(`queued drain rejects ${loss}`, () => {
      const f = fixture(); observe(f);
      if (loss === 'player-death') { f.player.setVar(pv('death'), 1); f.player.levels[3] = 0; }
      if (loss === 'npc-death') f.npc.levels[3] = 0;
      if (loss === 'removed') { f.npc.lifecycle = EntityLifeCycle.DESPAWN; World.removeNpc(f.npc, -1); }
      if (loss === 'retargeted') f.npc.setVar(nv('npc_attacking_uid'), f.player.uid + 1);
      assert.equal(settle(f).energy, 10000, 'stale effect is inert');
    });
    check('target pointer is the hit player, not another registered player', () => {
      const f = fixture();
      const other = new Player('bc03_other', 1002n, 100002n);
      other.slot = other.pid = 2; other.uid = (1002 << 11) | 2; other.isActive = true;
      other.runenergy = 5000; other.baseLevels.fill(80); other.levels.fill(80); other.vars.fill(0); other.write = () => {};
      World.players[2] = other; World.playerLoop.add(other.hash64, other);
      try { observe(f); settle(f); assert.equal(f.player.runenergy, 8000); assert.equal(other.runenergy, 5000); assert.equal(other.levels[3], 80); }
      finally { World.players[2] = null; other.unlink(); }
    });
    check('seeded native stream covers hit/miss/zero and proc/non-proc without extra draws', () => {
      const seen = new Set();
      for (let index = 1; index <= 256; index++) {
        const f = fixture(); const seed = Math.imul(index, 0x9e3779b9) >>> 0;
        f.player.setVar(pv('com_crushdef'), 1000); // Disclosed defensive-roll fixture, not a product value.
        const result = rt.observe(attack.name, f, [], 'seeded', { seed });
        assert.equal(result.snapshot.execution, State.FINISHED); assert.deepEqual(result.errors, []);
        const random = result.events.filter(e => e.op === 'RANDOM' || e.op === 'RANDOMINC');
        const hit = Math.trunc(random[0].out[0]) > Math.trunc(random[1].out[0]);
        assert.equal(result.draws.length, hit ? 4 : 2);
        assert.equal(random.filter(e => e.op === 'RANDOM').length, Number(hit));
        const procs = hit && Math.trunc(random[3].out[0]) === 0;
        assert.equal(corruption(result).length, Number(procs), JSON.stringify({ seed, random, queued: result.snapshot.queued }));
        assert.equal(damage(result).length, 1);
        if (hit) assert.equal(damage(result)[0].args[0], Math.trunc(random[2].out[0]));
        const delivered = settle(f);
        assert.equal(delivered.energy, procs ? 8000 : 10000);
        seen.add(!hit ? 'miss' : Math.trunc(random[2].out[0]) === 0 ? 'zero' : 'positive');
        if (hit) seen.add(procs ? 'proc' : 'non-proc');
      }
      assert.deepEqual([...seen].sort(), ['miss', 'non-proc', 'positive', 'proc', 'zero']);
    });
    check('native regeneration restores every drained stat exactly every 16 ticks and caps at base', () => {
      const { npc } = fixture(); npc.processRegen();
      assert.equal(npc.regenInterval, 16);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] - 1;
      const before = [...npc.levels];
      for (let tick = 0; tick < 15; tick++) npc.processRegen();
      assert.deepEqual([...npc.levels], before);
      npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let tick = 0; tick < 16; tick++) npc.processRegen();
      assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] + 1;
      for (let tick = 0; tick < 16; tick++) npc.processRegen();
      assert.deepEqual([...npc.levels], [...npc.baseLevels], 'native over-base decay also uses the selected rate');
    });
    check('attack and special preserve ownership, hero attribution and genuine death credit', () => {
      const f = fixture(); f.player.x = 3570; f.player.z = 9685; f.player.level = 3;
      f.npc.x = 3571; f.npc.z = 9685; f.npc.level = 3;
      for (let x = 3565; x < 3576; x++) for (let z = 9680; z < 9690; z++) routefinder.__set(x, z, 3, 0);
      f.player.setVar(pv('barrows_state'), 1 | (1 << 3)); f.player.setVar(pv('barrows_generation'), 17);
      f.npc.setVar(nv('npc_barrows_owner'), f.player.uid); f.npc.setVar(nv('npc_barrows_generation'), 17);
      f.npc.heroPoints.addHero(f.player.hash64, 100);
      observe(f); settle(f);
      assert.equal(f.npc.getVar(nv('npc_barrows_owner')), f.player.uid);
      assert.equal(f.npc.getVar(nv('npc_barrows_generation')), 17);
      assert.equal(f.npc.heroPoints.findHero(), f.player.hash64);
      assert.equal(f.player.getVar(pv('barrows_kills')), 0);
      f.npc.enqueueScript(Trigger.AI_QUEUE2, 0, 100);
      World.currentTick++; f.npc.turn(); f.player.processQueues();
      assert.equal(f.npc.levels[3], 0, 'native damage queue receives last_int, not a synthetic proc-local argument');
      for (let tick = 0; tick < 16 && (f.npc.isActive || [...f.player.queue.all()].length); tick++) {
        World.currentTick++; if (f.npc.isActive) f.npc.turn(); f.player.processQueues();
      }
      assert.equal(f.npc.isActive, false);
      assert.equal(f.player.getVar(pv('barrows_kills')), (1 << 4) | (115 << 6) | (1 << 17));
    });
    console.log(`BC-03 Torag: ${checks} compiled native checks PASS`);
  } finally { rt.dispose(); }
});
