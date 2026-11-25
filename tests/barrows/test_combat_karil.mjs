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
  const [{ default: Trigger }, { default: Player }, { default: Runner }, { NpcMode }, { Interaction }, { default: JavaRandom }, routefinder, { CollisionFlag }] = await Promise.all([
    load('src/engine/script/ServerTriggerType.ts'), load('src/engine/entity/Player.ts'), load('src/engine/script/ScriptRunner.ts'),
    load('src/engine/entity/NpcMode.ts'), load('src/engine/entity/Interaction.ts'), load('src/util/JavaRandom.ts'),
    load('src/engine/routefinder/index.ts'), load('src/engine/routefinder/flags.ts')
  ]);
  const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
  const { World, Provider, State, configs: { NpcType, VarNpcType, VarPlayerType, ParamType, SeqType, SpotanimType } } = rt;
  const nv = name => rt.id(VarNpcType, name), pv = name => rt.id(VarPlayerType, name);
  const type = NpcType.getByName('barrows_karil');
  const attack = Provider.getByTrigger(Trigger.AI_APPLAYER2, type.id, type.category);
  const queued = (result, name) => result.snapshot.queued.filter(q => q.script === `[queue,${name}]`);
  const random = result => result.events.filter(e => e.op === 'RANDOM' || e.op === 'RANDOMINC');
  const procDraws = [0.999999, 0, 0.999999, 0];
  let checks = 0;
  const check = (label, body) => { body(); checks++; console.log(`PASS BC-07 ${label}`); };
  const clear = (level, x, z, radius = 12) => {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) routefinder.__set(x + dx, z + dz, level, 0);
  };
  const fixture = (variant = 'hit', distance = 1) => {
    rt.dispose();
    const f = rt.fixture('barrows_karil', variant, 'ranged', distance);
    clear(0, f.player.x, f.player.z);
    for (const [i, name] of ['com_stabdef', 'com_slashdef', 'com_crushdef', 'com_rangedef', 'com_magicdef'].entries()) f.player.setVar(pv(name), 101 * (i + 1));
    return f;
  };
  const owned = f => {
    clear(3, 3554, 9682);
    f.player.teleport(3554, 9682, 3); f.npc.teleport(3559, 9682, 3);
    f.player.setVar(pv('barrows_state'), 1 | (1 << 3)); f.player.setVar(pv('barrows_generation'), 17);
    f.npc.setVar(nv('npc_barrows_owner'), f.player.uid); f.npc.setVar(nv('npc_barrows_generation'), 17);
    f.npc.lifecycle = EntityLifeCycle.DESPAWN;
  };
  const observe = (f, rng = { draws: procDraws }, name = attack.name, args = []) => {
    const result = rt.observe(name, f, args, 'seeded', rng);
    assert.equal(result.snapshot.execution, State.FINISHED); assert.equal(result.snapshot.error, null); assert.deepEqual(result.errors, []);
    return result;
  };
  const settle = (f, ticks = 1) => { const result = rt.settle(f, ticks); assert.equal(result.error, null); return result; };
  const playerCall = (f, name) => {
    const script = name === 'logout' ? Provider.getByTrigger(Trigger.LOGOUT, -1, -1) : Provider.getByName(`[proc,${name}]`);
    assert(script, name);
    const state = Runner.init(script, f.player);
    assert.equal(f.player.runScript(state, true), State.FINISHED, name);
  };
  const otherPlayer = () => {
    const other = new Player('bc07_other', 1002n, 100002n);
    other.slot = other.pid = 2; other.uid = (1002 << 11) | 2; other.isActive = true;
    other.baseLevels.fill(80); other.levels.fill(80); other.vars.fill(0); other.write = () => {};
    World.players[2] = other; World.playerLoop.add(other.hash64, other); return other;
  };
  const assertDelivery = (f, result, magnitude, special, distance = 1) => {
    const ticks = Math.floor((32 + 5 * distance) / 30);
    const expected = ['[queue,combat_damage_player]', '[queue,playerhit_n_retaliate]', ...(special ? ['[queue,barrows_karil_tainted_shot]'] : [])];
    assert.deepEqual(result.snapshot.queued.map(q => q.script), expected, 'native damage, retaliation, then special');
    assert.deepEqual(queued(result, 'combat_damage_player').map(q => q.args), [[magnitude]], 'exactly one native hit');
    assert.deepEqual(result.snapshot.queued.map(q => q.delay), expected.map(() => ticks), 'same native delivery tick');
    assert.deepEqual(queued(result, 'barrows_karil_tainted_shot').map(q => q.args), special ? [[f.npc.uid]] : []);
    const projectile = result.events.filter(e => e.op === 'PROJANIM_PL');
    assert.equal(projectile.length, 1, 'one actual projectile');
    assert.deepEqual(projectile[0].in.slice(0, 8), [11, 15, 32 + 5 * distance, 32, 36, 40, rt.id(SpotanimType, 'crossbowbolt_travel'), f.player.uid]);
    const initial = [...f.player.levels];
    // World runs the NPC phase before this same tick's player queues.
    f.player.processQueues();
    assert.deepEqual([...f.player.levels], initial, 'launch-tick queue pass cannot deliver early');
    if (ticks > 1) {
      const pending = settle(f, ticks - 1);
      assert.deepEqual(pending.levels, initial, 'neither damage nor drain lands early');
    }
    const delivered = settle(f);
    assert.equal(delivered.levels[3], initial[3] - magnitude);
    assert.equal(delivered.events.filter(e => e.op === 'DAMAGE').length, 1, 'one damage application');
    const expectedLevels = [...initial]; expectedLevels[3] -= magnitude;
    if (special) expectedLevels[16] = Math.max(initial[16] - Math.floor(f.player.baseLevels[16] / 5), 0);
    assert.deepEqual(delivered.levels, expectedLevels, 'only HP and the intended Agility change');
    assert.equal(delivered.events.filter(e => e.op === 'STAT_SUB').length, Number(special));
    if (special) {
      const drain = delivered.events.find(e => e.op === 'STAT_SUB'); assert.deepEqual(drain.in, [20, 0, 16]);
      assert(delivered.events.findIndex(e => e.op === 'DAMAGE') < delivered.events.indexOf(drain), 'drain follows damage');
    }
    assert.deepEqual(delivered.messages, []); assert.equal(f.npc.getVar(nv('npc_action_delay')), 104);
    return delivered;
  };
  try {
    check('packed fields, exact presentation and unchanged lifecycle bindings', () => {
      assert.equal(type.id, 2028); assert.equal(type.vislevel, 98);
      assert.deepEqual([...type.stats], [1, 100, 1, 100, 100, 1]); assert.equal(type.regenrate, 16);
      for (const [field, value] of Object.entries({ attackrange: 8, huntmode: -1, huntrange: 0, wanderrange: 5, maxrange: 7, timer: -1 })) assert.equal(type[field], value, field);
      const selected = { attackrate: 4, damagetype: 3, attackbonus: 0, strengthbonus: 0, magicattack: -26, rangeattack: 134, rangebonus: 55,
        stabdefence: 79, slashdefence: 71, crushdefence: 90, magicdefence: 106, rangedefence: 100, barrows_maxhit: 20,
        attack_anim: rt.id(SeqType, 'barrows_repeating_crossbow_fire'), rangeattack_sound: 1075,
        proj_launch: rt.id(SpotanimType, 'crossbowbolt_launch'), proj_travel: rt.id(SpotanimType, 'crossbowbolt_travel'),
        defend_sound: 1071, death_sound: 1072 };
      for (const [name, value] of Object.entries(selected)) {
        assert(type.params.has(rt.id(ParamType, name)), `explicit ${name}`); assert.equal(rt.param(type, name), value, name);
      }
      assert.equal(type.params.size, Object.keys(selected).length);
      assert.equal(rt.param(type, 'defend_anim'), rt.id(SeqType, 'human_unarmed_def'));
      assert.equal(rt.param(type, 'death_anim'), rt.id(SeqType, 'human_death'));
      assert.equal(attack.name, '[ai_applayer2,barrows_karil]');
      for (const trigger of ['AI_TIMER', 'AI_QUEUE3', 'AI_QUEUE1']) assert.equal(Provider.getByTrigger(Trigger[trigger], type.id, type.category).name, `[${trigger.toLowerCase()},barrows_karil]`);
    });
    for (const distance of [1, 5, 6, 8]) check(`native ranged accuracy, presentation, timing and one hit at distance ${distance}`, () => {
      const f = fixture('hit', distance), result = observe(f);
      assert.deepEqual(random(result).map(e => [e.op, e.in]), [['RANDOMINC', [21582]], ['RANDOMINC', [404]], ['RANDOMINC', [20]], ['RANDOM', [4]]]);
      assert.equal(result.draws.length, 4); assert(result.visited.includes('[proc,npc_rangeattack_outcome]'));
      assert(!result.visited.some(name => /npc_meleeattack|npc_default_attack_outcome/.test(name)), 'no melee fallback');
      assert.equal(result.events.filter(e => e.op === 'NPC_ANIM').length, 1);
      assert.equal(result.events.filter(e => e.op === 'SPOTANIM_NPC').length, 1);
      assert.equal(result.events.filter(e => e.op === 'SOUND_SYNTH').length, 1);
      assertDelivery(f, result, 20, true, distance);
    });
    for (const [label, draws, magnitude, special] of [
      ['miss', [0, 0.999999], 0, false], ['accurate zero', [0.999999, 0, 0, 0], 0, true],
      ['non-proc boundary', [0.999999, 0, 0.999999, 0.25], 20, false],
      ['25-percent boundary', [0.999999, 0, 0.999999, 0.225], 20, true]
    ]) check(`${label} uses exactly the eligible random draws`, () => {
      const f = fixture(), result = observe(f, { draws }); assert.equal(result.draws.length, draws.length);
      assertDelivery(f, result, magnitude, special);
    });
    for (const variant of ['protected-hit', 'protected-zero', 'protected-miss']) check(`${variant} blocks damage without suppressing the accuracy-based special`, () => {
      const f = fixture(variant, 8), draws = variant.endsWith('miss') ? [0, 0.999999] : [0.999999, 0, variant.endsWith('zero') ? 0 : 0.999999, 0];
      const result = observe(f, { draws });
      assert.equal(random(result)[0].in[0], 21582, 'protected roll keeps unprotected accuracy');
      assertDelivery(f, result, 0, !variant.endsWith('miss'), 8);
    });
    for (const prayer of ['prayer12', 'prayer14']) check(`${prayer} does not block a ranged hit at adjacency`, () => {
      const f = fixture(); f.player.setVar(pv(prayer), 1); assertDelivery(f, observe(f), 20, true);
    });
    for (const [base, decrement] of [[1, 0], [2, 0], [5, 1], [50, 10], [99, 19]]) check(`base Agility ${base} drains ${decrement}, repeatedly, with native zero floor`, () => {
      const f = fixture(); f.player.baseLevels[16] = base; f.player.levels[16] = base;
      const result = observe(f); assertDelivery(f, result, 20, true);
      assert.equal(f.player.levels[16], base - decrement);
      for (let repetition = 0; repetition < 8; repetition++) observe(f, { draws: [] }, '[queue,barrows_karil_tainted_shot]', [f.npc.uid]);
      assert.equal(f.player.levels[16], Math.max(base - decrement * 9, 0));
    });
    for (const variant of ['pending', 'target-loss', 'npc-busy', 'dead-player', 'dead-npc']) check(`${variant} has no attack or special draw`, () => {
      const f = fixture(variant), result = observe(f);
      assert.equal(result.draws.length, 0); assert.equal(result.snapshot.queued.length, 0);
    });
    check('OP bridge and AP retaliation preserve the native ranged mode', () => {
      const f = fixture(), bridge = observe(f, { draws: [] }, '[ai_opplayer2,barrows_karil]');
      assert.equal(f.npc.targetOp, NpcMode.APPLAYER2); assert.equal(bridge.draws.length, 0); assert.equal(bridge.snapshot.queued.length, 0);
      f.npc.setInteraction(Interaction.SCRIPT, f.player, NpcMode.NONE);
      observe(f, { draws: [] }, '[ai_queue1,barrows_karil]');
      assert.equal(f.npc.target, f.player); assert.equal(f.npc.targetOp, NpcMode.APPLAYER2);
    });
    check('real AP turns shoot four ticks apart without closing to melee, including reach 8', () => {
      const f = fixture('hit', 8); f.npc.setInteraction(Interaction.SCRIPT, f.player, NpcMode.APPLAYER2);
      const origin = [f.npc.x, f.npc.z], launches = [], previousRandom = JavaRandom.nextDouble;
      JavaRandom.nextDouble = () => 0.999999;
      try {
        for (let tick = 100; tick <= 112; tick++) {
          World.currentTick = tick; const before = f.npc.getVar(nv('npc_action_delay'));
          f.npc.turn();
          if (f.npc.getVar(nv('npc_action_delay')) !== before) launches.push(tick);
          f.player.processQueues(); assert.deepEqual([f.npc.x, f.npc.z], origin);
        }
      } finally { JavaRandom.nextDouble = previousRandom; }
      assert.deepEqual(launches, [100, 104, 108, 112]);
      f.player.x = f.npc.x - 9; assert.equal(f.npc.inApproachDistance(type.attackrange, f.player), false);
      f.player.x = f.npc.x - 8; assert.equal(f.npc.inApproachDistance(type.attackrange, f.player), true);
    });
    check('native line of sight prevents a ranged attack through crypt-level obstruction', () => {
      const f = fixture(); owned(f);
      for (let z = 9672; z <= 9692; z++) routefinder.__set(3556, z, 3, CollisionFlag.LOC | CollisionFlag.LOC_PROJ_BLOCKER);
      assert.equal(f.npc.inApproachDistance(type.attackrange, f.player), false);
      f.npc.setInteraction(Interaction.SCRIPT, f.player, NpcMode.APPLAYER2); f.npc.turn();
      assert.equal(f.npc.getVar(nv('npc_action_delay')), 0); assert.equal([...f.player.queue.all()].length, 0);
    });
    for (const loss of ['player-death', 'npc-death', 'retargeted', 'leave', 'logout']) check(`pending delivery after ${loss} keeps native damage and refuses stale special`, () => {
      const f = fixture('hit', 8), other = otherPlayer(); owned(f); f.npc.teleport(f.player.x + 8, f.player.z, f.player.level);
      try {
        const result = observe(f); assert.equal(queued(result, 'barrows_karil_tainted_shot').length, 1);
        f.player.processQueues();
        if (loss === 'player-death') { f.player.levels[3] = 0; f.player.setVar(pv('death'), 1); }
        if (loss === 'npc-death') f.npc.levels[3] = 0;
        if (loss === 'retargeted') f.npc.setVar(nv('npc_attacking_uid'), other.uid);
        if (loss === 'leave') { playerCall(f, 'barrows_leave'); assert.equal(f.npc.isActive, false); }
        if (loss === 'logout') {
          playerCall(f, 'logout'); assert.equal(f.npc.isActive, false);
          World.players[1] = null; f.player.unlink(); f.player.cleanup();
          assert.equal([...f.player.queue.all()].length, 0, 'native player cleanup cancels pending delivery');
        }
        settle(f, 2); assert.equal(f.player.levels[16], 80); assert.equal(other.levels[16], 80); assert.equal(other.levels[3], 80);
        assert.equal([...other.queue.all()].length, 0); assert.equal(other.getVar(pv('barrows_kills')), 0);
        assert.equal(f.player.levels[3], loss === 'player-death' ? 0 : loss === 'logout' ? 255 : 235, 'unchanged source-free native projectile damage policy');
      } finally { World.players[2] = null; other.unlink(); }
    });
    check('ownership timer removes departed owner and does not drain a real second player', () => {
      const f = fixture(), other = otherPlayer(); owned(f);
      try {
        observe(f); f.player.processQueues(); f.player.teleport(3500, 3500, 0);
        observe(f, { draws: [] }, '[ai_timer,barrows_karil]'); assert.equal(f.npc.isActive, false);
        settle(f, 2); assert.equal(f.player.levels[16], 80); assert.equal(other.levels[16], 80);
      } finally { World.players[2] = null; other.unlink(); }
    });
    check('256 native seeds in both prayer states cover proc, non-proc, miss and zero with no extra draws', () => {
      const seen = new Set();
      for (let index = 1; index <= 256; index++) for (const praying of [false, true]) {
        const f = fixture(praying ? 'protected-hit' : 'hit', 8); f.player.setVar(pv('com_rangedef'), 20000);
        const result = observe(f, { seed: Math.imul(index, 0x9e3779b9) >>> 0 }), rolls = random(result);
        const values = rolls.map(e => Math.trunc(e.out[0]));
        const hit = values[0] > values[1], rolled = hit ? values[2] : 0, procs = hit && values[3] === 0;
        assert.equal(result.draws.length, hit ? 4 : 2); assert.equal(rolled <= 20, true);
        assertDelivery(f, result, praying ? 0 : rolled, procs, 8);
        seen.add(!hit ? 'miss' : rolled ? 'positive' : 'zero'); if (hit) seen.add(procs ? 'proc' : 'non-proc');
      }
      assert.deepEqual([...seen].sort(), ['miss', 'non-proc', 'positive', 'proc', 'zero']);
    });
    check('regeneration restores all six stats at 16 with cap and over-base decay', () => {
      const { npc } = fixture(); npc.processRegen(); assert.equal(npc.regenInterval, 16);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] - 1;
      const before = [...npc.levels]; for (let tick = 0; tick < 15; tick++) npc.processRegen();
      assert.deepEqual([...npc.levels], before); npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] + 1;
      for (let tick = 0; tick < 16; tick++) npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
    });
    check('ordinary incoming player damage has no later flat-armour adjustment', () => {
      const f = fixture(); owned(f); f.npc.teleport(f.player.x + 1, f.player.z, f.player.level);
      for (const [name, value] of Object.entries({ tutorial: 1000, action_delay: 0, damagetype: 0, damagestyle: 0, com_stabattack: 100000, com_maxhit: 1 })) f.player.setVar(pv(name), value);
      const result = observe(f, { draws: [0.999999, 0, 0.999999] }, '[label,player_melee_attack]');
      assert.equal(random(result).at(-1).in[0], 1, 'one native inclusive 0–1 player magnitude');
      assert.equal(f.npc.levels[3], 100, 'player attack queues rather than directly applies damage');
      World.currentTick++; f.npc.turn(); f.player.processQueues();
      assert.equal(f.npc.levels[3], 99, 'one rolled damage stays one damage; no later flat armour −2');
    });
    check('ordinary owned player killing hit preserves Karil credit and second-player isolation', () => {
      const f = fixture(), other = otherPlayer(); owned(f); f.npc.teleport(f.player.x + 1, f.player.z, f.player.level);
      try {
        for (const [name, value] of Object.entries({ tutorial: 1000, action_delay: 0, damagetype: 0, damagestyle: 0, com_stabattack: 100000, com_maxhit: 100 })) f.player.setVar(pv(name), value);
        observe(f, { draws: [0.999999, 0, 0.999999] }, '[label,player_melee_attack]');
        for (let tick = 0; tick < 20 && (f.npc.isActive || [...f.player.queue.all()].length); tick++) {
          World.currentTick++; if (f.npc.isActive) f.npc.turn(); f.player.processQueues();
        }
        assert.equal(f.npc.isActive, false); assert.equal(f.player.getVar(pv('barrows_kills')), (1 << 3) | (98 << 6) | (1 << 17));
        assert.equal(other.getVar(pv('barrows_kills')), 0); assert.equal(other.levels[16], 80); assert.equal(other.levels[3], 80);
      } finally { World.players[2] = null; other.unlink(); }
    });
    console.log(`BC-07 Karil: ${checks} compiled native checks PASS`);
  } finally { rt.dispose(); }
});
