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
  const [{ default: Trigger }, { default: Player }, routefinder] = await Promise.all([
    load('src/engine/script/ServerTriggerType.ts'), load('src/engine/entity/Player.ts'), load('src/engine/routefinder/index.ts')
  ]);
  const { World, Provider, State, configs: { NpcType, VarNpcType, VarPlayerType, ParamType } } = rt;
  const nv = name => rt.id(VarNpcType, name), pv = name => rt.id(VarPlayerType, name);
  const type = NpcType.getByName('barrows_verac');
  const attack = Provider.getByTrigger(Trigger.AI_OPPLAYER2, type.id, type.category);
  const damage = result => result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]');
  const random = result => result.events.filter(e => e.op === 'RANDOM' || e.op === 'RANDOMINC');
  let checks = 0;
  const check = (label, body) => { body(); checks++; console.log(`PASS BC-05 ${label}`); };
  const fixture = (variant = 'hit') => { rt.dispose(); return rt.fixture('barrows_verac', variant); };
  const observe = (f, draws, name = attack.name) => {
    const result = rt.observe(name, f, [], 'seeded', { draws });
    assert.equal(result.snapshot.execution, State.FINISHED);
    assert.equal(result.snapshot.error, null); assert.deepEqual(result.errors, []);
    return result;
  };
  const settle = f => { const result = rt.settle(f, 1); assert.equal(result.error, null); return result; };
  const assertDelivery = (f, result, magnitude) => {
    assert.deepEqual(damage(result).map(q => q.args), [[magnitude]], 'one native hit');
    assert.deepEqual(result.snapshot.queued.map(q => q.script), ['[queue,combat_damage_player]', '[queue,playerhit_n_retaliate]']);
    const delivered = settle(f);
    assert.equal(delivered.levels[3], 255 - magnitude);
    assert.equal(delivered.events.filter(e => e.op === 'DAMAGE').length, 1);
    assert.deepEqual(delivered.messages, [], 'no invented effect message');
    return delivered;
  };
  const otherPlayer = () => {
    const other = new Player('bc05_other', 1002n, 100002n);
    other.slot = other.pid = 2; other.uid = (1002 << 11) | 2; other.isActive = true;
    other.baseLevels.fill(80); other.levels.fill(80); other.vars.fill(0); other.write = () => {};
    World.players[2] = other; World.playerLoop.add(other.hash64, other); return other;
  };
  try {
    check('packed fields, exact kept params, removed params absent and original bindings', () => {
      assert.equal(type.id, 2030); assert.equal(type.vislevel, 115);
      assert.deepEqual([...type.stats], [100, 100, 100, 100, 1, 1]); assert.equal(type.regenrate, 16);
      for (const [field, value] of Object.entries({ attackrange: 0, huntmode: -1, huntrange: 0, wanderrange: 5, maxrange: 7, timer: -1 })) assert.equal(type[field], value, field);
      const selected = { attackrate: 5, damagetype: 0, attackbonus: 0, strengthbonus: 72, magicattack: -42, rangeattack: -14, rangebonus: 0,
        stabdefence: 227, slashdefence: 230, crushdefence: 221, magicdefence: 0, rangedefence: 225, barrows_maxhit: 23,
        attack_anim: rt.id(rt.configs.SeqType, 'barrow_dharok_crush'),
        defend_anim: rt.id(rt.configs.SeqType, 'human_axe_block'),
        attack_sound: 1077, defend_sound: 1071, death_sound: 1072 };
      for (const [name, value] of Object.entries(selected)) {
        assert(type.params.has(rt.id(ParamType, name)), `present ${name}`);
        assert.equal(rt.param(type, name), value, name);
      }
      for (const name of ['stabattack', 'crushattack']) assert.equal(type.params.has(rt.id(ParamType, name)), false, `removed ${name}`);
      assert.equal(type.params.size, Object.keys(selected).length);
      assert.equal(attack.name, '[ai_opplayer2,barrows_verac]');
      for (const [trigger, name] of [[Trigger.AI_TIMER, '[ai_timer,barrows_verac]'], [Trigger.AI_QUEUE3, '[ai_queue3,barrows_verac]'], [Trigger.AI_QUEUE1, '[ai_queue1,_]']]) assert.equal(Provider.getByTrigger(trigger, type.id, type.category).name, name);
    });
    for (const strength of [1, 100, 150]) check(`ordinary Stab maximum 23 independent of Strength ${strength}`, () => {
      const f = fixture(); f.npc.levels[2] = strength;
      for (const [i, name] of ['com_stabdef', 'com_slashdef', 'com_crushdef'].entries()) f.player.setVar(pv(name), 113 + i * 101);
      const result = observe(f, [0.999999, 0.999999, 0, 0.999999]);
      assert.deepEqual(random(result).map(e => [e.op, e.in]), [['RANDOM', [4]], ['RANDOMINC', [6976]], ['RANDOMINC', [113]], ['RANDOMINC', [23]]]);
      assert.equal(f.npc.getVar(nv('npc_action_delay')), 105); assertDelivery(f, result, 23);
    });
    for (const [draw, procs] of [[0, true], [0.249999, true], [0.25, false], [0.5, false], [0.999999, false]]) check(`pre-accuracy one-in-four boundary ${draw}`, () => {
      const f = fixture(); const result = observe(f, [draw, 0.999999, 0, 0.999999]);
      const rolls = random(result);
      assert.deepEqual(rolls[0].in, [4]); assert.equal(rolls[0].op, 'RANDOM');
      assert.deepEqual(rolls.map(e => e.op), procs ? ['RANDOM', 'RANDOMINC'] : ['RANDOM', 'RANDOMINC', 'RANDOMINC', 'RANDOMINC']);
      assert.equal(result.draws.length, procs ? 2 : 4); assertDelivery(f, result, 23);
    });
    for (const praying of [false, true]) for (const [draw, expected] of [[0, 0], [0.5, praying ? 8 : 12], [0.999999, praying ? 15 : 23]]) check(`effect ${praying ? 'through prayer 0..15' : 'unprotected 0..23'} draw ${draw}`, () => {
      const f = fixture(praying ? 'protected-hit' : 'hit'); f.player.setVar(pv('com_stabdef'), 1000000000);
      const result = observe(f, [0, draw]);
      assert.deepEqual(random(result).map(e => [e.op, e.in]), [['RANDOM', [4]], ['RANDOMINC', [praying ? 15 : 23]]]);
      assert.equal(result.draws.length, 2, 'unconditional accuracy skips both accuracy draws');
      assertDelivery(f, result, expected);
    });
    for (const praying of [false, true]) for (const hit of [false, true]) check(`ordinary ${hit ? 'accuracy-favouring' : 'miss-favouring'} draws ${praying ? 'blocked by prayer' : 'without prayer'}`, () => {
      const f = fixture(praying ? 'protected-hit' : 'hit'); f.player.setVar(pv('com_stabdef'), 1000000000);
      const result = observe(f, [0.999999, hit ? 0.999999 : 0, hit ? 0 : 0.999999, 0.999999]);
      const rolls = random(result), landed = hit && !praying;
      assert.equal(result.draws.length, landed ? 4 : 3);
      assert.deepEqual(rolls.slice(0, 3).map(e => e.in), [[4], [praying ? 0 : 6976], [1000000000]]);
      if (landed) assert.deepEqual(rolls[3].in, [23]);
      assertDelivery(f, result, landed ? 23 : 0);
    });
    check('ordinary landed zero uses one zero-magnitude native delivery', () => {
      const f = fixture(); const result = observe(f, [0.999999, 0.999999, 0, 0]);
      assert.equal(result.draws.length, 4); assertDelivery(f, result, 0);
    });
    for (const variant of ['pending', 'target-loss', 'npc-busy', 'dead-player', 'dead-npc']) check(`${variant} consumes no effect or accuracy draw and creates no hit`, () => {
      const f = fixture(variant); const result = observe(f, [0, 0.999999]);
      assert.equal(result.draws.length, 0); assert.equal(damage(result).length, 0);
    });
    for (const praying of [false, true]) check(`effect damages only the real target with second registered player${praying ? ' through prayer' : ''}`, () => {
      const f = fixture(praying ? 'protected-hit' : 'hit'), other = otherPlayer();
      try {
        f.npc.setVar(nv('npc_barrows_owner'), f.player.uid);
        const result = observe(f, [0, 0.999999]); assertDelivery(f, result, praying ? 15 : 23);
        assert.equal(other.levels[3], 80); assert.equal([...other.queue.all()].length, 0);
        assert.equal(other.getVar(pv('barrows_kills')), 0); assert.equal(f.npc.getVar(nv('npc_barrows_owner')), f.player.uid);
      } finally { World.players[2] = null; other.unlink(); }
    });
    check('lost target is a real different registered player, not an unresolved uid', () => {
      const f = fixture('target-loss'), other = otherPlayer();
      try {
        f.npc.setVar(nv('npc_attacking_uid'), other.uid);
        const result = observe(f, [0, 0.999999]); assert.equal(result.draws.length, 0); assert.equal(damage(result).length, 0);
        settle(f); assert.equal(f.player.levels[3], 255); assert.equal(other.levels[3], 80); assert.equal([...other.queue.all()].length, 0);
      } finally { World.players[2] = null; other.unlink(); }
    });
    check('only the selected Verac Stab effect adds its weapon-named sound', () => {
      const presentations = [];
      for (const draw of [0, 0.999999]) {
        const f = fixture(); const result = observe(f, [draw, 0.999999, 0, 0.999999]);
        const delivered = assertDelivery(f, result, 23);
        presentations.push([...result.events, ...delivered.events].filter(e => /ANIM|SPOTANIM|SOUND/.test(e.op)));
      }
      const [proc, ordinary] = presentations;
      const effectSound = event => event.op === 'SOUND_SYNTH' && event.in.at(-1) === 1060;
      const effectGraphic = event => event.op === 'SPOTANIM_PL';
      assert.equal(proc.filter(effectSound).length, 1);
      assert.equal(ordinary.filter(effectSound).length, 0);
      assert.equal(proc.filter(effectGraphic).length, 0);
      assert.equal(ordinary.filter(effectGraphic).length, 0);
      assert.deepEqual(proc.filter(event => !effectSound(event)), ordinary,
        'the ordinary attack presentation stays unchanged');
    });
    check('256 native seeds: high Stab defence, exact pre-draw order and delivered four-case outcomes', () => {
      const seen = new Set(); let ordinaryMisses = 0, ordinaryHits = 0, effectHits = 0;
      for (let index = 1; index <= 256; index++) for (const praying of [false, true]) {
        const f = fixture(praying ? 'protected-hit' : 'hit'); f.player.setVar(pv('com_stabdef'), 100000);
        const result = rt.observe(attack.name, f, [], 'seeded', { seed: Math.imul(index, 0x9e3779b9) >>> 0 });
        assert.equal(result.snapshot.execution, State.FINISHED); assert.deepEqual(result.errors, []);
        const rolls = random(result); assert.equal(rolls[0].op, 'RANDOM'); assert.deepEqual(rolls[0].in, [4]);
        const effect = Math.trunc(rolls[0].out[0]) === 0;
        const hit = effect || Math.trunc(rolls[1].out[0]) > Math.trunc(rolls[2].out[0]);
        const maximum = effect && praying ? 15 : praying ? 0 : 23;
        const magnitude = hit ? Math.trunc(rolls[effect ? 1 : 3].out[0]) : 0;
        assert.equal(result.draws.length, effect ? 2 : hit ? 4 : 3);
        assert.deepEqual(rolls.map(e => e.op), effect ? ['RANDOM', 'RANDOMINC'] : hit ? ['RANDOM', 'RANDOMINC', 'RANDOMINC', 'RANDOMINC'] : ['RANDOM', 'RANDOMINC', 'RANDOMINC']);
        if (!effect) assert.deepEqual(rolls.slice(1, 3).map(e => e.in), [[praying ? 0 : 6976], [100000]]);
        if (hit) assert.deepEqual(rolls.at(-1).in, [maximum]);
        assert(magnitude >= 0 && magnitude <= maximum); assertDelivery(f, result, magnitude);
        seen.add(`${effect ? 'effect' : 'ordinary'}-${praying ? 'protected' : 'open'}`);
        seen.add(!hit ? 'miss' : magnitude === 0 ? 'zero' : 'positive');
        if (!praying) { if (effect) effectHits++; else if (hit) ordinaryHits++; else ordinaryMisses++; }
      }
      assert.deepEqual([...seen].sort(), ['effect-open', 'effect-protected', 'miss', 'ordinary-open', 'ordinary-protected', 'positive', 'zero']);
      assert(effectHits > 0 && ordinaryHits > 0 && ordinaryMisses > ordinaryHits, 'observed high-defence misses exactly follow native rolls');
    });
    check('native regeneration restores all six stats every 16 ticks, caps and decays over-base', () => {
      const { npc } = fixture(); npc.processRegen(); assert.equal(npc.regenInterval, 16);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] - 1;
      const before = [...npc.levels]; for (let tick = 0; tick < 15; tick++) npc.processRegen();
      assert.deepEqual([...npc.levels], before); npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let tick = 0; tick < 16; tick++) npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] + 1;
      for (let tick = 0; tick < 16; tick++) npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
    });
    check('ordinary player killing hit preserves owned Verac credit and spares second player', () => {
      const f = fixture(), other = otherPlayer();
      try {
        f.player.x = 3570; f.player.z = 9685; f.player.level = 3; f.npc.x = 3571; f.npc.z = 9685; f.npc.level = 3;
        for (let x = 3565; x < 3576; x++) for (let z = 9680; z < 9690; z++) routefinder.__set(x, z, 3, 0);
        f.player.setVar(pv('barrows_state'), 1 | (1 << 3)); f.player.setVar(pv('barrows_generation'), 17);
        f.npc.setVar(nv('npc_barrows_owner'), f.player.uid); f.npc.setVar(nv('npc_barrows_generation'), 17);
        for (const [name, value] of Object.entries({ tutorial: 1000, action_delay: 0, damagetype: 0, damagestyle: 0, com_stabattack: 100000, com_maxhit: 100 })) f.player.setVar(pv(name), value);
        observe(f, [0.999999, 0, 0.999999], '[label,player_melee_attack]');
        for (let tick = 0; tick < 20 && (f.npc.isActive || [...f.player.queue.all()].length); tick++) {
          World.currentTick++; if (f.npc.isActive) f.npc.turn(); f.player.processQueues();
        }
        assert.equal(f.npc.isActive, false); assert.equal(f.player.getVar(pv('barrows_kills')), (1 << 5) | (115 << 6) | (1 << 17));
        assert.equal(other.getVar(pv('barrows_kills')), 0); assert.equal(other.levels[3], 80);
      } finally { World.players[2] = null; other.unlink(); }
    });
    console.log(`BC-05 Verac: ${checks} compiled native checks PASS`);
  } finally { rt.dispose(); }
});
