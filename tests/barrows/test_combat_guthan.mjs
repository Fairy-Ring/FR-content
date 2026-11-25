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
  const [{ default: Trigger }, { default: Player }, { default: Npc }, routefinder, { EntityLifeCycle }] = await Promise.all([
    load('src/engine/script/ServerTriggerType.ts'), load('src/engine/entity/Player.ts'), load('src/engine/entity/Npc.ts'),
    load('src/engine/routefinder/index.ts'), load('src/engine/entity/EntityLifeCycle.ts')
  ]);
  const { World, Provider, State, configs: { NpcType, VarNpcType, VarPlayerType } } = rt;
  const nv = name => rt.id(VarNpcType, name), pv = name => rt.id(VarPlayerType, name);
  const type = NpcType.getByName('barrows_guthan');
  const attack = Provider.getByTrigger(Trigger.AI_OPPLAYER2, type.id, type.category);
  const queued = (result, name) => result.snapshot.queued.filter(q => q.script === `[queue,${name}]`);
  let checks = 0;
  const check = (label, body) => { body(); checks++; console.log(`PASS BC-04 ${label}`); };
  const fixture = (variant = 'hit', hp = 40) => {
    rt.dispose(); const f = rt.fixture('barrows_guthan', variant);
    if (variant !== 'dead-npc') f.npc.levels[3] = hp;
    return f;
  };
  const observe = (f, draws = [0.999999, 0, 0.999999, 0], name = attack.name) => {
    const result = rt.observe(name, f, [], 'seeded', { draws });
    assert.equal(result.snapshot.execution, State.FINISHED);
    assert.equal(result.snapshot.error, null); assert.deepEqual(result.errors, []);
    return result;
  };
  const settle = (f, ticks = 1) => {
    const result = rt.settle(f, ticks); assert.equal(result.error, null); return result;
  };
  const otherPlayer = () => {
    const other = new Player('bc04_other', 1002n, 100002n);
    other.slot = other.pid = 2; other.uid = (1002 << 11) | 2; other.isActive = true;
    other.baseLevels.fill(80); other.levels.fill(80); other.vars.fill(0); other.write = () => {};
    World.players[2] = other; World.playerLoop.add(other.hash64, other); return other;
  };
  const owned = (f) => {
    f.player.x = 3570; f.player.z = 9685; f.player.level = 3;
    f.npc.x = 3571; f.npc.z = 9685; f.npc.level = 3;
    for (let x = 3565; x < 3576; x++) for (let z = 9680; z < 9690; z++) routefinder.__set(x, z, 3, 0);
    f.player.setVar(pv('barrows_state'), 1 | (1 << 3)); f.player.setVar(pv('barrows_generation'), 17);
    f.npc.setVar(nv('npc_barrows_owner'), f.player.uid); f.npc.setVar(nv('npc_barrows_generation'), 17);
  };
  const playerHit = (f, magnitude) => {
    for (const [name, value] of Object.entries({ tutorial: 1000, action_delay: 0, damagetype: 2, damagestyle: 0,
      com_crushattack: 100000, com_maxhit: magnitude })) f.player.setVar(pv(name), value);
    return observe(f, [0.999999, 0, 0.999999], '[label,player_melee_attack]');
  };
  const finishDeath = f => {
    for (let tick = 0; tick < 20 && (f.npc.isActive || [...f.player.queue.all()].length); tick++) {
      World.currentTick++; if (f.npc.isActive) f.npc.turn(); f.player.processQueues();
    }
    assert.equal(f.npc.isActive, false, 'native death removes the summoned actor');
  };
  const credit = (1 << 2) | (115 << 6) | (1 << 17);
  try {
    check('packed field group, original identity, owned bindings and native defaults', () => {
      assert.equal(type.id, 2027); assert.equal(type.vislevel, 115);
      assert.deepEqual([...type.stats], [100, 100, 100, 100, 1, 1]); assert.equal(type.regenrate, 16);
      for (const [field, value] of Object.entries({ attackrange: 0, huntmode: -1, huntrange: 0, wanderrange: 5, maxrange: 7, timer: -1 })) assert.equal(type[field], value, field);
      const selected = { attackrate: 5, damagetype: 2, attackbonus: 0, strengthbonus: 75, magicattack: -50, rangeattack: -19, rangebonus: 0,
        stabdefence: 259, slashdefence: 257, crushdefence: 241, magicdefence: -11, rangedefence: 250, barrows_maxhit: 24 };
      for (const [name, value] of Object.entries(selected)) assert.equal(rt.param(type, name), value, name);
      assert.equal(type.params.size, Object.keys(selected).length);
      assert.equal(attack.name, '[ai_opplayer2,barrows_guthan]');
      for (const [trigger, name] of [[Trigger.AI_TIMER, '[ai_timer,barrows_guthan]'], [Trigger.AI_QUEUE3, '[ai_queue3,barrows_guthan]'], [Trigger.AI_QUEUE1, '[ai_queue1,_]']]) assert.equal(Provider.getByTrigger(trigger, type.id, type.category).name, name);
    });
    for (const strength of [1, 100, 150]) check(`explicit maximum 24 at current Strength ${strength}`, () => {
      const f = fixture(); f.npc.levels[2] = strength;
      for (const [i, name] of ['com_stabdef', 'com_slashdef', 'com_crushdef'].entries()) f.player.setVar(pv(name), 113 + i * 101);
      const result = observe(f);
      assert.deepEqual(result.events.filter(e => e.op === 'RANDOMINC').map(e => e.in), [[6976], [315], [24]]);
      assert.deepEqual(queued(result, 'combat_damage_player').map(q => q.args), [[24]]);
      assert.equal(f.npc.getVar(nv('npc_action_delay')), 105);
      assert.equal(f.npc.levels[3], 40, 'heal is queued, not immediate');
      assert.equal(settle(f).levels[3], 231); assert.equal(f.npc.levels[3], 64);
    });
    for (const [hp, expected] of [[40, 64], [90, 100], [99, 100], [100, 100]]) check(`native bounded heal ${hp} to ${expected}`, () => {
      const f = fixture('hit', hp); const result = observe(f);
      assert.equal(result.draws.length, 4, 'full health still consumes the proc draw');
      assert.deepEqual(queued(result, 'barrows_guthan_infestation').map(q => q.args), [[f.npc.uid, 24]]);
      assert.deepEqual(result.snapshot.queued.map(q => q.script), ['[queue,combat_damage_player]', '[queue,playerhit_n_retaliate]', '[queue,barrows_guthan_infestation]']);
      assert.equal(queued(result, 'barrows_guthan_infestation')[0].delay, 0);
      const delivered = settle(f); assert.equal(f.npc.levels[3], expected); assert.equal(delivered.levels[3], 231);
      const heals = delivered.events.filter(e => e.op === 'NPC_STATHEAL');
      assert.equal(heals.length, Number(hp < 100));
      if (hp < 100) assert(delivered.events.findIndex(e => e.op === 'DAMAGE') < delivered.events.findIndex(e => e.op === 'NPC_STATHEAL'), 'damage precedes healing');
      assert.deepEqual(delivered.messages, [], 'no invented message');
    });
    for (const [draw, procs] of [[0, true], [0.249999, true], [0.25, false], [0.5, false], [0.999999, false]]) check(`one-in-four boundary ${draw}`, () => {
      const f = fixture(); const result = observe(f, [0.999999, 0, 0.999999, draw]);
      assert.deepEqual(result.events.filter(e => e.op === 'RANDOM').map(e => e.in), [[4]]);
      assert.equal(result.draws.length, 4); assert.equal(queued(result, 'barrows_guthan_infestation').length, Number(procs));
      assert.equal(settle(f).levels[3], 231); assert.equal(f.npc.levels[3], procs ? 64 : 40);
    });
    for (const variant of ['miss', 'zero', 'protected-hit', 'protected-zero', 'protected-miss']) check(`${variant} same-roll damage and heal gate`, () => {
      const f = fixture(variant), missed = variant.endsWith('miss'), zero = variant.endsWith('zero');
      const result = observe(f, missed ? [0, 0.999999] : [0.999999, 0, zero ? 0 : 0.999999, 0]);
      assert.equal(result.draws.length, missed ? 2 : 4);
      assert.equal(queued(result, 'combat_damage_player').length, 1);
      assert.equal(queued(result, 'barrows_guthan_infestation').length, Number(!missed));
      assert.deepEqual(queued(result, 'combat_damage_player')[0].args, [0]);
      assert.equal(settle(f).levels[3], 255); assert.equal(f.npc.levels[3], 40);
    });
    for (const [hp, expectedPlayer, expectedNpc] of [[30, 10, 60], [5, 0, 40], [20, 0, 40]]) check(`20 damage with ${hp} remaining Hitpoints`, () => {
      const f = fixture(); f.player.levels[3] = hp;
      const result = observe(f, [0.999999, 0, 0.8, 0]);
      assert.deepEqual(queued(result, 'combat_damage_player')[0].args, [20]);
      const delivered = settle(f); assert.equal(delivered.levels[3], expectedPlayer); assert.equal(f.npc.levels[3], expectedNpc);
      assert.equal(delivered.events.filter(e => e.op === 'NPC_STATHEAL').length, Number(hp > 20), 'a fatal or exactly lethal same hit never heals');
    });
    for (const variant of ['pending', 'target-loss', 'npc-busy', 'dead-player', 'dead-npc']) check(`${variant} creates no hit or proc`, () => {
      const f = fixture(variant); const result = observe(f);
      assert.equal(result.draws.length, 0); assert.equal(queued(result, 'combat_damage_player').length, 0);
      assert.equal(queued(result, 'barrows_guthan_infestation').length, 0);
    });
    for (const loss of ['player-death', 'npc-death', 'removed', 'retargeted']) check(`queued heal rejects ${loss} with real second player`, () => {
      const f = fixture(), other = otherPlayer();
      try {
        observe(f);
        if (loss === 'player-death') { f.player.setVar(pv('death'), 1); f.player.levels[3] = 0; }
        if (loss === 'npc-death') f.npc.levels[3] = 0;
        if (loss === 'removed') { f.npc.lifecycle = EntityLifeCycle.DESPAWN; World.removeNpc(f.npc, -1); }
        if (loss === 'retargeted') f.npc.setVar(nv('npc_attacking_uid'), other.uid);
        const before = f.npc.levels[3]; settle(f); assert.equal(f.npc.levels[3], before);
        assert.equal(other.levels[3], 80); assert.equal(other.getVar(pv('barrows_kills')), 0);
      } finally { World.players[2] = null; other.unlink(); }
    });
    check('two registered players and two Guthans heal only the captured attacking NPC', () => {
      const f = fixture(), other = otherPlayer();
      const second = new Npc(0, f.npc.x + 2, f.npc.z, 1, 1, EntityLifeCycle.DESPAWN, 2, type.id, type.blockwalk);
      World.addNpc(second, -1); second.levels[3] = 30;
      second.setVar(nv('npc_barrows_owner'), other.uid); second.setVar(nv('npc_attacking_uid'), other.uid);
      f.npc.setVar(nv('npc_barrows_owner'), f.player.uid);
      try {
        observe(f); settle(f); assert.equal(f.npc.levels[3], 64); assert.equal(second.levels[3], 30);
        assert.equal(other.levels[3], 80); assert.equal(other.getVar(pv('barrows_kills')), 0);
        assert.equal(f.npc.getVar(nv('npc_barrows_owner')), f.player.uid);
      } finally { World.players[2] = null; other.unlink(); }
    });
    check('seeded native stream covers proc, non-proc, miss and zero with no extra draws', () => {
      const seen = new Set();
      for (let index = 1; index <= 256; index++) {
        const f = fixture(); f.player.setVar(pv('com_crushdef'), 1000);
        const result = rt.observe(attack.name, f, [], 'seeded', { seed: Math.imul(index, 0x9e3779b9) >>> 0 });
        assert.equal(result.snapshot.execution, State.FINISHED); assert.deepEqual(result.errors, []);
        const random = result.events.filter(e => e.op === 'RANDOM' || e.op === 'RANDOMINC');
        const hit = Math.trunc(random[0].out[0]) > Math.trunc(random[1].out[0]);
        const magnitude = hit ? Math.trunc(random[2].out[0]) : 0;
        const procs = hit && Math.trunc(random[3].out[0]) === 0;
        assert.equal(result.draws.length, hit ? 4 : 2); assert.equal(queued(result, 'combat_damage_player').length, 1);
        assert.equal(queued(result, 'barrows_guthan_infestation').length, Number(procs));
        assert.equal(settle(f).levels[3], 255 - magnitude); assert.equal(f.npc.levels[3], 40 + (procs ? magnitude : 0));
        seen.add(!hit ? 'miss' : magnitude === 0 ? 'zero' : 'positive'); if (hit) seen.add(procs ? 'proc' : 'non-proc');
      }
      assert.deepEqual([...seen].sort(), ['miss', 'non-proc', 'positive', 'proc', 'zero']);
    });
    check('native regeneration restores all six stats each 16 ticks with base cap and over-base decay', () => {
      const { npc } = fixture(); npc.processRegen(); assert.equal(npc.regenInterval, 16);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] - 1;
      const before = [...npc.levels]; for (let tick = 0; tick < 15; tick++) npc.processRegen();
      assert.deepEqual([...npc.levels], before); npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let tick = 0; tick < 16; tick++) npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
      for (let stat = 0; stat < 6; stat++) npc.levels[stat] = npc.baseLevels[stat] + 1;
      for (let tick = 0; tick < 16; tick++) npc.processRegen(); assert.deepEqual([...npc.levels], [...npc.baseLevels]);
    });
    for (const pending of [false, true]) check(`full heal then ordinary killing hit credits owner${pending ? ' after a pre-heal calculated hit lands' : ''}`, () => {
      const f = fixture('hit', 90); owned(f); f.npc.heroPoints.addHero(f.player.hash64, 50);
      if (pending) { playerHit(f, 10); assert(f.npc.heroPoints.findHero() === f.player.hash64); }
      // Reset only native readiness, so the same-tick opposing hit can heal before the queued player impact.
      f.npc.setVar(nv('npc_action_delay'), 0); observe(f); settle(f);
      assert.equal(f.npc.levels[3], 100); assert.equal(f.npc.heroPoints.findHero(), -1n, 'NpcOps.ts:300-301 native full heal clears old heroes');
      if (pending) { World.currentTick++; f.npc.processQueue(); assert.equal(f.npc.levels[3], 90); }
      playerHit(f, 100); assert.equal(f.npc.heroPoints.findHero(), f.player.hash64, 'ordinary new hit re-records hero');
      finishDeath(f); assert.equal(f.player.getVar(pv('barrows_kills')), credit);
    });
    check('AS BUILT native full-heal credit clearing: pre-heal hit plus poison-only finish has no credit and permits retry', () => {
      const f = fixture('hit', 90); owned(f); playerHit(f, 10);
      f.npc.setVar(nv('npc_action_delay'), 0); observe(f); settle(f);
      assert.equal(f.npc.heroPoints.findHero(), -1n);
      World.currentTick++; f.npc.processQueue(); assert.equal(f.npc.levels[3], 90);
      // Ruling 1 preserves NpcOps.ts:300-301. Disclosed severity fixtures isolate the
      // no-new-hero consequence; they do not claim this is a normal poison dose.
      while (f.npc.levels[3] > 0) {
        f.npc.setVar(nv('npc_poison'), 30);
        const result = rt.observe('[proc,npc_poison_timer]', f); assert.equal(result.snapshot.execution, State.FINISHED);
      }
      finishDeath(f); assert.equal(f.player.getVar(pv('barrows_kills')), 0);
      assert.equal(f.player.getVar(pv('barrows_generation')), 17);
      const retry = rt.observe('[proc,barrows_brother_find]', f, [type.id]); assert.deepEqual(retry.values, [0], 'removed uncredited brother cannot suppress resummon');
      assert.equal(f.player.getVar(pv('barrows_state')), 1 | (1 << 3));
    });
    console.log(`BC-04 Guthan: ${checks} compiled native checks PASS`);
  } finally { rt.dispose(); }
});
