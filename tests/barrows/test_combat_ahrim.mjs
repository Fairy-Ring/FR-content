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
  const [{ default: Trigger }, { default: Player }, { default: Runner }, { NpcMode }, { Interaction }, { default: JavaRandom }, routefinder, { CollisionFlag }, { EntityLifeCycle }] = await Promise.all([
    load('src/engine/script/ServerTriggerType.ts'), load('src/engine/entity/Player.ts'), load('src/engine/script/ScriptRunner.ts'),
    load('src/engine/entity/NpcMode.ts'), load('src/engine/entity/Interaction.ts'), load('src/util/JavaRandom.ts'),
    load('src/engine/routefinder/index.ts'), load('src/engine/routefinder/flags.ts'), load('src/engine/entity/EntityLifeCycle.ts')
  ]);
  const { World, Provider, State, configs: { NpcType, VarNpcType, VarPlayerType, ParamType } } = rt;
  const nv = name => rt.id(VarNpcType, name), pv = name => rt.id(VarPlayerType, name);
  const type = NpcType.getByName('barrows_ahrim');
  const attack = Provider.getByTrigger(Trigger.AI_APPLAYER2, type.id, type.category);
  const random = r => r.events.filter(e => e.op === 'RANDOM' || e.op === 'RANDOMINC');
  const clear = (level, x, z, radius = 13) => {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) routefinder.__set(x + dx, z + dz, level, 0);
  };
  const fixture = (variant = 'hit', distance = 1) => {
    rt.dispose(); const f = rt.fixture('barrows_ahrim', variant, 'magic', distance);
    clear(0, f.player.x, f.player.z);
    f.player.setVar(pv('com_magicdef'), 505);
    return f;
  };
  const observe = (f, draws, name = attack.name, args = []) => {
    const r = rt.observe(name, f, args, 'seeded', Array.isArray(draws) ? { draws } : draws);
    assert.equal(r.snapshot.execution, State.FINISHED); assert.equal(r.snapshot.error, null); assert.deepEqual(r.errors, []);
    return r;
  };
  const settle = (f, ticks = 3) => { const r = rt.settle(f, ticks); assert.equal(r.error, null); return r; };
  const cast = (f, selection, proc = 0, magnitude = 0.999999) => observe(f, [selection, 0.999999, 0, magnitude, proc]);
  const owned = f => {
    clear(3, 3554, 9682); f.player.teleport(3554, 9682, 3); f.npc.teleport(3559, 9682, 3);
    f.player.setVar(pv('barrows_state'), 2 | (1 << 3)); f.player.setVar(pv('barrows_generation'), 17);
    f.npc.setVar(nv('npc_barrows_owner'), f.player.uid); f.npc.setVar(nv('npc_barrows_generation'), 17);
    f.npc.lifecycle = EntityLifeCycle.DESPAWN;
  };
  const playerCall = (f, name) => {
    const script = name === 'logout' ? Provider.getByTrigger(Trigger.LOGOUT, -1, -1) : Provider.getByName(`[proc,${name}]`);
    assert.equal(f.player.runScript(Runner.init(script, f.player), true), State.FINISHED);
  };
  const otherPlayer = () => {
    const p = new Player('bc08_other', 1002n, 100002n);
    p.slot = p.pid = 2; p.uid = (1002 << 11) | 2; p.isActive = true;
    p.baseLevels.fill(80); p.levels.fill(80); p.vars.fill(0); p.write = () => {};
    World.players[2] = p; World.playerLoop.add(p.hash64, p); return p;
  };
  const aura = r => r.events.filter(e => e.op === 'STAT_SUB' && e.in[0] === 0 && e.in[1] === 5 && e.in[2] === 2);
  const noMelee = r => assert(!r.visited.some(name => /npc_meleeattack|npc_default_attack_outcome/.test(name)), 'no melee fallback');
  let checks = 0;
  const check = (label, body) => { body(); checks++; console.log(`PASS BC-08 ${label}`); };
  try {
    check('packed Magic vector, native reach, all-stat regeneration and owned dispatch', () => {
      assert.equal(type.id, 2025); assert.equal(type.vislevel, 98);
      assert.deepEqual([...type.stats], [1, 100, 1, 100, 1, 100]);
      for (const [key, value] of Object.entries({ attackrange: 10, regenrate: 16, huntmode: -1, huntrange: 0, wanderrange: 5, maxrange: 7, timer: -1 })) assert.equal(type[key], value, key);
      const params = { attackrate: 6, damagetype: 4, attackbonus: 0, strengthbonus: 68, magicattack: 73, rangeattack: -19, rangebonus: 0,
        stabdefence: 103, slashdefence: 85, crushdefence: 117, magicdefence: 73, rangedefence: 0, barrows_maxhit: 20,
        defend_anim: 2079, defend_sound: 1071, death_sound: 1072 };
      for (const [key, value] of Object.entries(params)) {
        assert(type.params.has(rt.id(ParamType, key)), `explicit ${key}`); assert.equal(rt.param(type, key), value, key);
      }
      assert.equal(type.params.size, Object.keys(params).length);
      assert.equal(attack.name, '[ai_applayer2,barrows_ahrim]');
      for (const trigger of ['AI_TIMER', 'AI_QUEUE1', 'AI_QUEUE3']) assert.equal(Provider.getByTrigger(Trigger[trigger], type.id, type.category).name, `[${trigger.toLowerCase()},barrows_ahrim]`);
    });
    const spells = [['fire_wave', null], ['confuse', 0], ['weaken', 2], ['curse', 1]];
    for (const [index, [name, stat]] of spells.entries()) for (const praying of [false, true]) check(`${name} ${praying ? 'protected' : 'ordinary'} native cast, impact and aura gate`, () => {
      const f = fixture(praying ? 'protected-hit' : 'hit', 8), before = [...f.player.levels];
      const r = cast(f, (index + 0.1) / 4); noMelee(r);
      assert.equal(random(r)[0].in[0], 4, 'one equal eligible choice');
      assert.equal(f.npc.getVar(nv('npc_action_delay')), 106);
      assert.equal(r.events.filter(e => e.op === 'NPC_ANIM').length, 1);
      assert.equal(r.events.find(e => e.op === 'NPC_ANIM').in.at(-1), rt.field(rt.spell(name), 'anim'));
      const success = !(praying && stat === null);
      assert.equal(aura(r).length, Number(success));
      assert.equal(r.draws.length, success ? 5 : 3, 'selection, native accuracy/magnitude, then only eligible aura');
      assert.equal(r.snapshot.messages.filter(text => text === 'You feel weakened.').length, Number(stat !== null));
      if (stat !== null) {
        assert(r.visited.includes('[proc,npc_stat_change_effect]'));
        assert(!r.visited.includes('[proc,npc_spell_fail]'), 'protected accurate stat spell has ordinary success, not splash');
        assert(f.player.levels[stat] < before[stat]);
        assert.equal(r.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]').length, 0, 'stat spell has no damage hitmark');
      } else {
        assert.equal(r.visited.includes('[proc,npc_spell_fail]'), praying);
        const damage = r.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]');
        assert.deepEqual(damage.map(q => [q.args, q.delay]), praying ? [] : [[[20], 4]], 'native distance-eight magic delivery tick');
      }
      const strengthDrain = stat === 2 ? 1 + Math.floor(f.player.baseLevels[2] * 5 / 100) : 0;
      assert.equal(f.player.levels[2], before[2] - strengthDrain - (success ? 5 : 0), 'Weaken percentage and flat aura remain separate');
      const graphics = r.events.filter(e => e.op === 'SPOTANIM_PL' && e.in.at(-1) === 400);
      assert.equal(graphics.length, Number(success));
      if (success) assert.deepEqual(graphics[0].in, [0, 0, 400], 'player attachment, height zero and immediate trigger');
      assert.equal(r.events.filter(e => e.op === 'SOUND_SYNTH' && e.in.at(-1) === 1083).length, Number(success));
      settle(f, 4); assert.equal(f.player.levels[3], before[3], 'no early damage while the native queue delay counts down');
      settle(f, 1); assert.equal(f.player.levels[3], before[3] - (!praying && stat === null ? 20 : 0));
    });
    for (let mask = 0; mask < 8; mask++) {
      const eligible = spells.filter(([, stat]) => stat === null || !(mask & (1 << [0, 2, 1].indexOf(stat))));
      for (const [choice, [name]] of eligible.entries()) check(`lowered mask ${mask} selects eligible ${name} without retries`, () => {
        const f = fixture(); [0, 2, 1].forEach((stat, bit) => { if (mask & (1 << bit)) f.player.levels[stat]--; });
        const r = cast(f, (choice + 0.1) / eligible.length, 0.9);
        assert.equal(random(r)[0].in[0], eligible.length);
        assert.equal(r.events.find(e => e.op === 'NPC_ANIM').in.at(-1), rt.field(rt.spell(name), 'anim'));
        assert.equal(r.events.filter(e => e.op === 'RANDOM' && e.in[0] !== 5).length, 1, 'one selection, no retry draw');
      });
    }
    for (const [label, draws, expectedAura, strength] of [
      ['miss', [0, 0, 0.999999], false, 80], ['accurate rolled zero', [0, 0.999999, 0, 0, 0], true, 75],
      ['last proc bucket', [0, 0.999999, 0, 1, 0.199999], true, 75], ['20-percent boundary', [0, 0.999999, 0, 1, 0.2], false, 80]
    ]) check(`${label}: exact successful-hit chance and cursor`, () => {
      const f = fixture(), r = observe(f, draws); assert.equal(r.draws.length, draws.length);
      assert.equal(aura(r).length, Number(expectedAura)); assert.equal(f.player.levels[2], strength);
      if (expectedAura) assert.deepEqual(random(r).at(-1).in, [5]);
    });
    for (const [name, index] of [['confuse', 1], ['weaken', 2], ['curse', 3]]) check(`protected ${name} miss splashes without stat drain or aura`, () => {
      const f = fixture('protected-miss'), before = [...f.player.levels];
      const r = observe(f, [(index + 0.1) / 4, 0, 0.999999]);
      assert.equal(r.draws.length, 3); assert.deepEqual([...f.player.levels], before);
      assert(r.visited.includes('[proc,npc_spell_fail]')); assert.equal(aura(r).length, 0); assert.deepEqual(r.snapshot.messages, []);
    });
    for (const strength of [0, 1, 4, 5, 6, 99]) check(`flat aura Strength ${strength} respects native zero floor`, () => {
      const f = fixture(); f.player.levels[2] = strength;
      const r = cast(f, 0); assert.equal(aura(r).length, 1); assert.equal(f.player.levels[2], Math.max(strength - 5, 0));
    });
    for (const variant of ['pending', 'target-loss', 'npc-busy', 'dead-player', 'dead-npc']) check(`${variant} refuses before selection`, () => {
      const f = fixture(variant), r = observe(f, []); assert.equal(r.draws.length, 0); assert.equal(r.snapshot.queued.length, 0);
    });
    check('OP bridge and queue1 retaliation choose AP; queue3 remains owned death', () => {
      const f = fixture(); observe(f, [], '[ai_opplayer2,barrows_ahrim]'); assert.equal(f.npc.targetOp, NpcMode.APPLAYER2);
      f.npc.setInteraction(Interaction.SCRIPT, f.player, NpcMode.NONE); observe(f, [], '[ai_queue1,barrows_ahrim]');
      assert.equal(f.npc.target, f.player); assert.equal(f.npc.targetOp, NpcMode.APPLAYER2);
    });
    for (const distance of [1, 10]) check(`real AP turns cast six ticks apart at distance ${distance}, without moving to melee`, () => {
      const f = fixture('hit', distance); f.npc.setInteraction(Interaction.SCRIPT, f.player, NpcMode.APPLAYER2);
      const origin = [f.npc.x, f.npc.z], launches = [], previous = JavaRandom.nextDouble; JavaRandom.nextDouble = () => 0;
      try {
        for (let tick = 100; tick <= 118; tick++) {
          World.currentTick = tick; const before = f.npc.getVar(nv('npc_action_delay')); f.npc.turn();
          if (f.npc.getVar(nv('npc_action_delay')) !== before) launches.push(tick);
          f.player.processQueues(); assert.deepEqual([f.npc.x, f.npc.z], origin);
        }
      } finally { JavaRandom.nextDouble = previous; }
      assert.deepEqual(launches, [100, 106, 112, 118]);
      f.player.x = f.npc.x - 11; assert.equal(f.npc.inApproachDistance(type.attackrange, f.player), false);
      f.player.x = f.npc.x - 10; assert.equal(f.npc.inApproachDistance(type.attackrange, f.player), true);
    });
    check('native projectile clipping blocks an obstructed crypt cast', () => {
      const f = fixture(); owned(f);
      for (let z = 9670; z <= 9695; z++) routefinder.__set(3556, z, 3, CollisionFlag.LOC | CollisionFlag.LOC_PROJ_BLOCKER);
      assert.equal(f.npc.inApproachDistance(type.attackrange, f.player), false);
      f.npc.setInteraction(Interaction.SCRIPT, f.player, NpcMode.APPLAYER2); f.npc.turn();
      assert.equal(f.npc.getVar(nv('npc_action_delay')), 0); assert.equal([...f.player.queue.all()].length, 0);
    });
    for (const loss of ['leave', 'logout']) check(`${loss} removes owned caster and prevents later aura on a second player`, () => {
      const f = fixture(), other = otherPlayer(); owned(f);
      try {
        const r = cast(f, 0, 0.9); assert.equal(aura(r).length, 0); playerCall(f, loss === 'leave' ? 'barrows_leave' : 'logout');
        assert.equal(f.npc.isActive, false); settle(f); assert.equal(other.levels[2], 80); assert.equal(other.levels[3], 80);
        assert.equal(other.getVar(pv('barrows_kills')), 0); assert.equal([...other.queue.all()].length, 0);
      } finally { World.players[2] = null; other.unlink(); }
    });
    check('owner timer removes caster after owner leaves the crypt', () => {
      const f = fixture(); owned(f); f.player.teleport(3500, 3500, 0);
      observe(f, [], '[ai_timer,barrows_ahrim]'); assert.equal(f.npc.isActive, false);
    });
    check('regeneration restores all six stats at 16, capped and over-base', () => {
      const { npc } = fixture(); npc.processRegen(); assert.equal(npc.regenInterval, 16);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] - 1;
      const before = [...npc.levels]; for (let tick = 0; tick < 15; tick++) npc.processRegen(); assert.deepEqual([...npc.levels], before);
      npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat]++;
      for (let tick = 0; tick < 16; tick++) npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
    });
    check('ordinary owned player killing hit earns exactly Ahrim credit and isolates the bystander', () => {
      const f = fixture(), other = otherPlayer(); owned(f); f.npc.teleport(f.player.x + 1, f.player.z, f.player.level);
      try {
        for (const [name, value] of Object.entries({ tutorial: 1000, action_delay: 0, damagetype: 0, damagestyle: 0, com_stabattack: 100000, com_maxhit: 100 })) f.player.setVar(pv(name), value);
        observe(f, [0.999999, 0, 0.999999], '[label,player_melee_attack]');
        for (let tick = 0; tick < 20 && (f.npc.isActive || [...f.player.queue.all()].length); tick++) {
          World.currentTick++; if (f.npc.isActive) f.npc.turn(); f.player.processQueues();
        }
        assert.equal(f.npc.isActive, false); assert.equal(f.player.getVar(pv('barrows_kills')), 1 | (98 << 6) | (1 << 17));
        assert.equal(other.getVar(pv('barrows_kills')), 0); assert.equal(other.levels[2], 80); assert.equal(other.levels[3], 80);
      } finally { World.players[2] = null; other.unlink(); }
    });
    console.log(`BC-08 Ahrim: ${checks} compiled native checks PASS`);
  } finally { rt.dispose(); }
});
