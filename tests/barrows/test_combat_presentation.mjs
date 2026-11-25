#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packedId, parseOptions, resolveRoots, run } from './packed.mjs';
import { runtime } from '../npc-combat/outcome_runtime.mjs';

await run(async () => {
  const { contentRoot, engineRoot, packDir } = resolveRoots(parseOptions());
  const rt = await runtime(engineRoot, packDir);
  const load = file => import(pathToFileURL(path.join(engineRoot, file)).href);
  const routefinder = await load('src/engine/routefinder/index.ts');
  const { State, configs: { NpcType, ParamType, SeqType, SpotanimType, VarPlayerType } } = rt;
  const paramId = name => rt.id(ParamType, name);
  const pv = name => rt.id(VarPlayerType, name);
  const check = (label, body) => { body(); console.log(`PASS BC-M2 ${label}`); };
  const fixture = (name, variant = 'hit', style = 'melee', distance = 1) => {
    rt.dispose();
    return rt.fixture(name, variant, style, distance);
  };
  const observe = (script, f, draws) => {
    const result = rt.observe(script, f, [], 'seeded', { draws });
    assert.equal(result.snapshot.execution, State.FINISHED);
    assert.equal(result.snapshot.error, null);
    assert.deepEqual(result.errors, []);
    return result;
  };
  const settle = (f, ticks = 6) => {
    const result = rt.settle(f, ticks);
    assert.equal(result.error, null);
    return result;
  };
  const playerGraphics = events => events.filter(event => event.op === 'SPOTANIM_PL');
  const effectSounds = (events, id) => events.filter(event => event.op === 'SOUND_SYNTH' && event.in.at(-1) === id);
  const assertPlayerGraphic = (events, id, height) => {
    assert.deepEqual(playerGraphics(events).map(event => event.in), [[0, height, id]]);
    assert.equal(events.filter(event => event.op === 'SPOTANIM_NPC' && event.in.at(-1) === id).length, 0,
      'the effect belongs to the player, not the brother');
  };
  const assertNoPlayerGraphic = events => assert.deepEqual(playerGraphics(events), []);
  const packedSynth = name => packedId(contentRoot, 'synth', name);
  const checkParams = (name, expected) => {
    const type = NpcType.getByName(name);
    assert(type, `packed NPC ${name}`);
    for (const [key, value] of Object.entries(expected)) {
      assert(type.params.has(paramId(key)), `${name} explicitly binds ${key}`);
      assert.equal(rt.param(type, key), value, `${name} ${key}`);
    }
  };
  const clear = (x, z, level = 0, radius = 12) => {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      routefinder.__set(x + dx, z + dz, level, 0);
    }
  };
  const rangedFixture = () => {
    const f = fixture('barrows_karil', 'hit', 'ranged', 1);
    clear(f.player.x, f.player.z);
    for (const [index, name] of ['com_stabdef', 'com_slashdef', 'com_crushdef', 'com_rangedef', 'com_magicdef'].entries()) {
      f.player.setVar(pv(name), 101 * (index + 1));
    }
    return f;
  };

  try {
    check('packed BC-M2 animations and all brother hit/death sounds', () => {
      const seq = (name, id) => { assert.equal(rt.id(SeqType, name), id, `packed sequence ${name}`); return id; };
      const expectedHit = packedSynth('wight_hit');
      const expectedDeath = packedSynth('wight_death');
      assert.equal(expectedHit, 1071);
      assert.equal(expectedDeath, 1072);
      checkParams('barrows_dharok', {
        attack_anim: seq('barrow_dharok_slash', 2066), defend_anim: seq('human_axe_block', 397),
        attack_sound: packedSynth('dharok_attack'), defend_sound: expectedHit, death_sound: expectedDeath
      });
      checkParams('barrows_guthan', {
        attack_anim: seq('barrows_war_spear_crush', 2082), defend_anim: seq('human_spear_block', 430),
        attack_sound: packedSynth('guthan_attack'), defend_sound: expectedHit, death_sound: expectedDeath
      });
      checkParams('barrows_torag', {
        attack_anim: seq('barrow_torag_crush', 2068), attack_sound: packedSynth('torag_attack'),
        defend_sound: expectedHit, death_sound: expectedDeath
      });
      checkParams('barrows_verac', {
        attack_anim: seq('barrow_dharok_crush', 2067), defend_anim: seq('human_axe_block', 397),
        attack_sound: packedSynth('verac_attack'), defend_sound: expectedHit, death_sound: expectedDeath
      });
      checkParams('barrows_karil', {
        attack_anim: seq('barrows_repeating_crossbow_fire', 2075), rangeattack_sound: packedSynth('karil_attack'),
        defend_sound: expectedHit, death_sound: expectedDeath
      });
      checkParams('barrows_ahrim', {
        defend_anim: seq('barrows_quarterstaff_defend', 2079), defend_sound: expectedHit, death_sound: expectedDeath
      });
    });

    check('Guthan shows Infestation only on a delivered heal, without another draw', () => {
      const id = rt.id(SpotanimType, 'barrows_guthan_effect');
      assert.equal(id, 398);
      const draws = [0.999999, 0, 0.999999, 0];
      const f = fixture('barrows_guthan');
      f.npc.levels[3] = 40;
      const result = observe('[ai_opplayer2,barrows_guthan]', f, draws);
      assert.deepEqual(result.draws, draws);
      assert.equal(result.snapshot.queued.filter(q => q.script === '[queue,barrows_guthan_infestation]').length, 1);
      assertNoPlayerGraphic(result.events);
      const delivered = settle(f);
      assertPlayerGraphic(delivered.events, id, 0);
      assert.equal(f.npc.levels[3], 64);
      assert.equal(delivered.events.filter(event => event.op === 'NPC_STATHEAL').length, 1);
      assert.equal(effectSounds(delivered.events, 1066).length, 0, 'no attack-type synth exists for Guthan Crush');

      const full = fixture('barrows_guthan');
      full.npc.levels[3] = 100;
      const fullResult = observe('[ai_opplayer2,barrows_guthan]', full, draws);
      assert.deepEqual(fullResult.draws, draws, 'the full-health gate still consumes the proc draw');
      const fullDelivery = settle(full);
      assertNoPlayerGraphic(fullDelivery.events);
      assert.equal(full.npc.levels[3], 100);
      assert.equal(fullDelivery.events.filter(event => event.op === 'NPC_STATHEAL').length, 0);
    });

    check('Torag shows Corruption and its Crush synth at the queued drain, without another draw', () => {
      const id = rt.id(SpotanimType, 'barrows_torag_effect');
      const sound = packedSynth('torag_crush');
      assert.equal(id, 399);
      assert.equal(sound, 1062);
      const draws = [0.999999, 0, 0.999999, 0];
      const f = fixture('barrows_torag');
      const result = observe('[ai_opplayer2,barrows_torag]', f, draws);
      assert.deepEqual(result.draws, draws);
      assert.equal(result.snapshot.queued.filter(q => q.script === '[queue,barrows_torag_corruption]').length, 1);
      assertNoPlayerGraphic(result.events);
      assert.equal(effectSounds(result.events, sound).length, 0);
      const delivered = settle(f);
      assertPlayerGraphic(delivered.events, id, 0);
      assert.deepEqual(effectSounds(delivered.events, sound).map(event => event.in), [[0, 0, sound]]);
      assert.equal(f.player.runenergy, 8000);

      const ordinary = fixture('barrows_torag');
      const noProc = observe('[ai_opplayer2,barrows_torag]', ordinary, [0.999999, 0, 0.999999, 0.25]);
      assert.deepEqual(noProc.draws, [0.999999, 0, 0.999999, 0.25]);
      assertNoPlayerGraphic(settle(ordinary).events);
    });

    check('Karil shows Tainted Shot on the player at projectile delivery, without another draw', () => {
      const id = rt.id(SpotanimType, 'barrows_karil_tainted_shot');
      assert.equal(id, 401);
      const draws = [0.999999, 0, 0.999999, 0];
      const f = rangedFixture();
      const result = observe('[ai_applayer2,barrows_karil]', f, draws);
      assert.deepEqual(result.draws, draws);
      assert.equal(result.snapshot.queued.filter(q => q.script === '[queue,barrows_karil_tainted_shot]').length, 1);
      assertNoPlayerGraphic(result.events);
      const delivered = settle(f);
      assertPlayerGraphic(delivered.events, id, 0);
      assert.equal(effectSounds(delivered.events, 1067).length, 0, 'the pack has no Karil ranged effect synth');
      assert.equal(delivered.events.filter(event => event.op === 'STAT_SUB').length, 1);

      const ordinary = rangedFixture();
      const noProc = observe('[ai_applayer2,barrows_karil]', ordinary, [0.999999, 0, 0.999999, 0.25]);
      assert.deepEqual(noProc.draws, [0.999999, 0, 0.999999, 0.25]);
      assertNoPlayerGraphic(settle(ordinary).events);
    });

    check('Verac Stab plays its named effect synth only on the proc and keeps its draw cursor', () => {
      const sound = packedSynth('flail_stab');
      assert.equal(sound, 1060);
      const proc = fixture('barrows_verac');
      const procResult = observe('[ai_opplayer2,barrows_verac]', proc, [0, 0.999999, 0, 0.999999]);
      assert.deepEqual(procResult.draws, [0, 0.999999]);
      assert.deepEqual(effectSounds(procResult.events, sound).map(event => event.in), [[0, 0, sound]]);
      assertNoPlayerGraphic(procResult.events);

      const ordinary = fixture('barrows_verac');
      const ordinaryResult = observe('[ai_opplayer2,barrows_verac]', ordinary, [0.999999, 0.999999, 0, 0.999999]);
      assert.deepEqual(ordinaryResult.draws, [0.999999, 0.999999, 0, 0.999999]);
      assert.equal(effectSounds(ordinaryResult.events, sound).length, 0);
      assertNoPlayerGraphic(ordinaryResult.events);
    });

    check('Dharok has no proc presentation or added draw', () => {
      const f = fixture('barrows_dharok');
      const result = observe('[ai_opplayer2,barrows_dharok]', f, [0.999999, 0, 0.999999]);
      assert.deepEqual(result.draws, [0.999999, 0, 0.999999]);
      assertNoPlayerGraphic(result.events);
      assert.equal(result.events.filter(event => event.op === 'SOUND_SYNTH' && event.in.at(-1) >= 1055 && event.in.at(-1) <= 1065).length, 0,
        'Dharok has no effect trigger moment');
    });

    console.log('BC-M2 presentation: packed bindings and ScriptRunner effect triggers PASS');
  } finally { rt.dispose(); }
});
