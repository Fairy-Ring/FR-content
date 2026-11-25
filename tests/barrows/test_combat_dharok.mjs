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
  const type = NpcType.getByName('barrows_dharok');
  const attack = Provider.getByTrigger(Trigger.AI_OPPLAYER2, type.id, type.category);
  const damage = result => result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]');
  const random = result => result.events.filter(e => e.op === 'RANDOM' || e.op === 'RANDOMINC');
  const maximum = hp => Math.floor((29 * (200 - hp) + 50) / 100);
  let checks = 0;
  const check = (label, body) => { body(); checks++; console.log(`PASS BC-06 ${label}`); };
  const fixture = (hp = 100, variant = 'hit') => {
    rt.dispose(); const f = rt.fixture('barrows_dharok', variant); f.npc.levels[3] = hp; return f;
  };
  const observe = (f, rng = { draws: [0.999999, 0, 0.999999] }, name = attack.name, args = []) => {
    const result = rt.observe(name, f, args, 'seeded', rng);
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
    const other = new Player('bc06_other', 1002n, 100002n);
    other.slot = other.pid = 2; other.uid = (1002 << 11) | 2; other.isActive = true;
    other.baseLevels.fill(80); other.levels.fill(80); other.vars.fill(0); other.write = () => {};
    World.players[2] = other; World.playerLoop.add(other.hash64, other); return other;
  };
  try {
    check('packed fields, exact params, selected presentation and lifecycle bindings', () => {
      assert.equal(type.id, 2026); assert.equal(type.vislevel, 115);
      assert.deepEqual([...type.stats], [100, 100, 100, 100, 1, 1]); assert.equal(type.regenrate, 16);
      for (const [field, value] of Object.entries({ attackrange: 0, huntmode: -1, huntrange: 0, wanderrange: 5, maxrange: 7, timer: -1 })) assert.equal(type[field], value, field);
      const selected = { attackrate: 7, damagetype: 1, attackbonus: 0, strengthbonus: 105, magicattack: -58, rangeattack: -18, rangebonus: 0,
        stabdefence: 252, slashdefence: 250, crushdefence: 244, magicdefence: -11, rangedefence: 249, barrows_maxhit: 29,
        attack_anim: rt.id(rt.configs.SeqType, 'barrow_dharok_slash'),
        defend_anim: rt.id(rt.configs.SeqType, 'human_axe_block'),
        attack_sound: 1073, defend_sound: 1071, death_sound: 1072 };
      for (const [name, value] of Object.entries(selected)) {
        assert(type.params.has(rt.id(ParamType, name)), `present ${name}`);
        assert.equal(rt.param(type, name), value, name);
      }
      assert.equal(type.params.size, Object.keys(selected).length);
      assert.equal(attack.name, '[ai_opplayer2,barrows_dharok]');
      for (const [trigger, name] of [[Trigger.AI_TIMER, '[ai_timer,barrows_dharok]'], [Trigger.AI_QUEUE3, '[ai_queue3,barrows_dharok]'], [Trigger.AI_QUEUE1, '[ai_queue1,_]']]) assert.equal(Provider.getByTrigger(trigger, type.id, type.category).name, name);
    });
    for (const [hp, expected] of [[100, 29], [98, 30], [50, 44], [1, 58]]) check(`literal maximum ${expected} at HP ${hp}`, () => {
      const f = fixture(hp), result = observe(f);
      assert.deepEqual(random(result).map(e => e.in), [[6976], [f.player.getVar(pv('com_slashdef'))], [expected]]);
      assertDelivery(f, result, expected);
    });
    check('every living HP uses the exact native bound, one current-HP read and monotonic maximum', () => {
      let previous = 59;
      for (let hp = 1; hp <= 100; hp++) {
        const f = fixture(hp);
        for (const [i, name] of ['com_stabdef', 'com_slashdef', 'com_crushdef'].entries()) f.player.setVar(pv(name), 113 + i * 101);
        const result = observe(f), rolls = random(result), expected = maximum(hp);
        assert.deepEqual(rolls.map(e => [e.op, e.in]), [['RANDOMINC', [6976]], ['RANDOMINC', [214]], ['RANDOMINC', [expected]]], `HP ${hp}`);
        const prefix = result.events.slice(0, result.events.indexOf(rolls[0]));
        assert.equal(prefix.filter(e => e.op === 'NPC_STAT' && e.in[0] === 3).length, 1, 'one scaling HP read');
        assert(expected <= previous); previous = expected;
        assert.equal(result.draws.length, 3); assert.equal(f.npc.getVar(nv('npc_action_delay')), 107);
        assertDelivery(f, result, expected);
      }
    });
    for (const strength of [1, 100, 150]) check(`scaled maximum ignores Strength ${strength} without changing it`, () => {
      const f = fixture(50); f.npc.levels[2] = strength;
      const result = observe(f); assert.deepEqual(random(result).at(-1).in, [44]);
      assert.equal(f.npc.levels[2], strength); assertDelivery(f, result, 44);
    });
    check('Protect from Melee blocks every living-HP attack with ordinary accuracy cursor', () => {
      for (let hp = 1; hp <= 100; hp++) {
        const f = fixture(hp, 'protected-hit'), result = observe(f);
        assert.deepEqual(random(result).map(e => [e.op, e.in]), [['RANDOMINC', [0]], ['RANDOMINC', [f.player.getVar(pv('com_slashdef'))]]]);
        assert.equal(result.draws.length, 2); assertDelivery(f, result, 0);
      }
    });
    for (const prayer of ['prayer12', 'prayer13']) check(`${prayer} alone does not block Slash or alter scaling`, () => {
      const f = fixture(1); f.player.setVar(pv(prayer), 1);
      const result = observe(f); assert.deepEqual(random(result).map(e => e.in), [[6976], [f.player.getVar(pv('com_slashdef'))], [58]]);
      assertDelivery(f, result, 58);
    });
    for (const [label, draws] of [['miss', [0, 0.999999]], ['accurate zero', [0.999999, 0, 0]]]) check(`${label} keeps native single-zero delivery`, () => {
      const f = fixture(1), result = observe(f, { draws }); assert.equal(result.draws.length, draws.length); assertDelivery(f, result, 0);
    });
    for (const variant of ['pending', 'target-loss', 'npc-busy', 'dead-player', 'dead-npc']) check(`${variant} consumes no draw and creates no hit`, () => {
      const f = fixture(variant === 'dead-npc' ? 0 : 50, variant), result = observe(f);
      assert.equal(result.draws.length, 0); assert.equal(damage(result).length, 0);
    });
    check('the real second player remains unhurt and a real lost target is refused', () => {
      const f = fixture(1), other = otherPlayer();
      try {
        assert.equal(World.getPlayerByUid(other.uid), other);
        f.npc.setVar(nv('npc_barrows_owner'), f.player.uid);
        assertDelivery(f, observe(f), 58);
        assert.equal(other.levels[3], 80); assert.equal([...other.queue.all()].length, 0); assert.equal(other.getVar(pv('barrows_kills')), 0);
        f.npc.setVar(nv('npc_action_delay'), 0);
        f.player.setVar(pv('aggressive_npc'), f.npc.uid + 1);
        f.npc.setVar(nv('npc_attacking_uid'), other.uid);
        const refused = observe(f); assert.equal(refused.draws.length, 0); assert.equal(damage(refused).length, 0);
        assert.equal(other.levels[3], 80); assert.equal([...other.queue.all()].length, 0);
      } finally { World.players[2] = null; other.unlink(); }
    });
    check('256 seeds and both prayer states equal the ordinary seam RNG cursor and native delivery', () => {
      const seen = new Set();
      for (let index = 1; index <= 256; index++) for (const praying of [false, true]) {
        const hp = (index % 100) + 1, seed = Math.imul(index, 0x9e3779b9) >>> 0;
        const f = fixture(hp, praying ? 'protected-hit' : 'hit'); f.player.setVar(pv('com_slashdef'), 100000);
        const actual = observe(f, { seed });
        const actualDamage = damage(actual)[0].args[0]; assertDelivery(f, actual, actualDamage);
        const control = fixture(hp, praying ? 'protected-hit' : 'hit'); control.player.setVar(pv('com_slashdef'), 100000);
        const ordinary = observe(control, { seed }, '[proc,npc_default_attack_outcome]', [maximum(hp), 0, 0]);
        assert.deepEqual(actual.draws, ordinary.draws); assert.deepEqual(random(actual), random(ordinary));
        assert.deepEqual(damage(actual), damage(ordinary));
        const presentation = r => r.events.filter(e => /ANIM|SPOTANIM|SOUND|^MES/.test(e.op));
        assert.deepEqual(presentation(actual), presentation(ordinary));
        assertDelivery(control, ordinary, actualDamage);
        seen.add(actualDamage > 0 ? 'positive' : random(actual).length === 3 ? 'accurate-zero' : 'miss');
      }
      assert.deepEqual([...seen].sort(), ['accurate-zero', 'miss', 'positive']);
    });
    check('native regeneration restores every stat at 16, caps and decays over-base', () => {
      const { npc } = fixture(); npc.processRegen(); assert.equal(npc.regenInterval, 16);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] - 1;
      const before = [...npc.levels]; for (let tick = 0; tick < 15; tick++) npc.processRegen();
      assert.deepEqual([...npc.levels], before); npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let tick = 0; tick < 16; tick++) npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] + 1;
      for (let tick = 0; tick < 16; tick++) npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
    });
    check('regeneration lowers the next maximum and a later HP change cannot rewrite queued damage', () => {
      const f = fixture(1); f.npc.processRegen(); f.npc.levels[3] = 1;
      const before = observe(f); assert.deepEqual(random(before).at(-1).in, [58]);
      for (let tick = 0; tick < 16; tick++) f.npc.processRegen(); assert.equal(f.npc.levels[3], 2);
      assertDelivery(f, before, 58);
      f.npc.setVar(nv('npc_action_delay'), 0);
      const after = observe(f); assert.deepEqual(random(after).at(-1).in, [57]);
      assert.deepEqual(damage(after).map(q => q.args), [[57]]);
      f.npc.levels[3] = 1; assert.deepEqual(damage(after).map(q => q.args), [[57]], 'post-attack damage changes only the next attack');
    });
    check('ordinary player killing hit preserves owned Dharok credit and spares second player', () => {
      const f = fixture(), other = otherPlayer();
      try {
        f.player.x = 3570; f.player.z = 9685; f.player.level = 3; f.npc.x = 3571; f.npc.z = 9685; f.npc.level = 3;
        for (let x = 3565; x < 3576; x++) for (let z = 9680; z < 9690; z++) routefinder.__set(x, z, 3, 0);
        f.player.setVar(pv('barrows_state'), 1 | (1 << 3)); f.player.setVar(pv('barrows_generation'), 17);
        f.npc.setVar(nv('npc_barrows_owner'), f.player.uid); f.npc.setVar(nv('npc_barrows_generation'), 17);
        for (const [name, value] of Object.entries({ tutorial: 1000, action_delay: 0, damagetype: 0, damagestyle: 0, com_stabattack: 100000, com_maxhit: 100 })) f.player.setVar(pv(name), value);
        observe(f, { draws: [0.999999, 0, 0.999999] }, '[label,player_melee_attack]');
        for (let tick = 0; tick < 20 && (f.npc.isActive || [...f.player.queue.all()].length); tick++) {
          World.currentTick++; if (f.npc.isActive) f.npc.turn(); f.player.processQueues();
        }
        assert.equal(f.npc.isActive, false); assert.equal(f.player.getVar(pv('barrows_kills')), (1 << 1) | (115 << 6) | (1 << 17));
        assert.equal(other.getVar(pv('barrows_kills')), 0); assert.equal(other.levels[3], 80);
      } finally { World.players[2] = null; other.unlink(); }
    });
    console.log(`BC-06 Dharok: ${checks} compiled native checks PASS`);
  } finally { rt.dispose(); }
});
