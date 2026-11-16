#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseOptions, resolveRoots, run } from './packed.mjs';
import { runtime } from '../npc-combat/outcome_runtime.mjs';

const BARROWS_HUNT_RADIUS = 4; // UNKNOWN historical distance; selected engineering value.
const TYPES = {
  barrows_bloodworm: { id: 2031, hp: 45, maximum: 3, style: 0, tiles: [[3548,9675],[3549,9679],[3551,9676],[3552,9679],[3552,9682],[3555,9675],[3555,9679]] },
  barrows_rat: { id: 2032, hp: 35, maximum: 3, style: 0, tiles: [[3531,9694],[3534,9690],[3534,9698],[3535,9695],[3537,9692],[3539,9695]] },
  barrows_giantrat: { id: 2033, hp: 70, maximum: 6, style: 0, tiles: [[3532,9696],[3533,9692],[3536,9697],[3537,9694]] },
  barrows_spider: { id: 2034, hp: 60, maximum: 6, style: 0, tiles: [[3566,9693],[3567,9698],[3569,9695],[3570,9691],[3572,9697]] },
  barrows_giantspider: { id: 2035, hp: 80, maximum: 8, style: 0, tiles: [[3566,9695],[3567,9691],[3567,9697],[3570,9697],[3571,9692],[3572,9694]] },
  barrows_skeleton_unarmed: { id: 2036, hp: 50, maximum: 10, style: 2, tiles: [[3548,9709],[3549,9713],[3553,9707]] },
  barrows_skeleton_armed: { id: 2037, hp: 50, maximum: 10, style: 1, tiles: [[3551,9714],[3554,9713],[3555,9709]] }
};

await run(async () => {
  const { contentRoot, engineRoot, packDir } = resolveRoots(parseOptions());
  const rt = await runtime(engineRoot, packDir);
  const load = file => import(pathToFileURL(path.join(engineRoot, file)).href);
  const [{ default: Trigger }, { NpcMode }, { Interaction }, { CoordGrid }, routefinder] = await Promise.all([
    load('src/engine/script/ServerTriggerType.ts'), load('src/engine/entity/NpcMode.ts'),
    load('src/engine/entity/Interaction.ts'), load('src/engine/CoordGrid.ts'), load('src/engine/routefinder/index.ts')
  ]);
  const { World, Provider, State, Pointer, configs: { NpcType, VarNpcType, VarPlayerType, HuntType } } = rt;
  const nv = name => rt.id(VarNpcType, name);
  const pv = name => rt.id(VarPlayerType, name);
  const delay = nv('npc_action_delay');
  const defences = ['com_stabdef', 'com_slashdef', 'com_crushdef'];
  const queueDamage = result => result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]');
  const dispatch = npc => {
    const type = NpcType.get(npc.type);
    const script = Provider.getByTrigger(Trigger.AI_OPPLAYER2, type.id, type.category);
    assert(script, `${type.debugname} native contact dispatch`);
    return script.name;
  };
  let count = 0;
  const check = (name, body) => { body(); count++; console.log(`PASS BC-02 ${name}`); };
  let zone = null;
  const fixture = (name, variant = 'hit', distance = 1) => {
    if (zone) { zone.leave(World.players[1]); zone = null; }
    rt.dispose();
    const f = rt.fixture(name, variant, 'melee', distance);
    for (let x = 3480; x <= 3520; x++) for (let z = 3480; z <= 3520; z++) routefinder.__set(x, z, 0, 0);
    return f;
  };
  const observed = (f, variant = 'hit', rng = null) => {
    const result = rt.observe(dispatch(f.npc), f, [], variant, rng);
    assert.equal(result.snapshot.execution, State.FINISHED, `${dispatch(f.npc)} completes`);
    assert.deepEqual(result.errors, []);
    assert.equal(result.snapshot.error, null);
    assert(result.snapshot.pointers & (1 << Pointer.ActivePlayer), 'correct player pointer retained');
    assert.equal(result.snapshot.pointers & (1 << Pointer.ProtectedActivePlayer), 0, 'native execution releases protection');
    assert.equal(result.snapshot.playerProtected, false);
    return result;
  };
  try {
    World.gameMap.init();
    check('all 34 original native static placements and non-owned actor bindings', () => {
      for (const [name, spec] of Object.entries(TYPES)) {
        const npcs = [...World.npcs].filter(npc => npc.type === spec.id);
        assert.equal(NpcType.getId(name), spec.id, `${name} original type`);
        assert.deepEqual(npcs.map(npc => [npc.startX, npc.startZ]).sort(), [...spec.tiles].sort(), `${name} original placements`);
        for (const npc of npcs) {
          assert.equal(npc.level, 0);
          assert.equal(npc.getVar(nv('npc_barrows_owner')), -1);
          assert.equal(npc.huntrange, BARROWS_HUNT_RADIUS);
          assert.equal(npc.huntMode, HuntType.getId('aggressive_melee'));
          assert.equal(npc.baseLevels[3], spec.hp);
        }
      }
    });
    for (const [name, spec] of Object.entries(TYPES)) {
      check(`${name} real dispatch, subtype, maximum, one hit and four-tick delay`, () => {
        const f = fixture(name);
        assert.equal(dispatch(f.npc), name.includes('skeleton') ? `[ai_opplayer2,${name}]` : '[ai_opplayer2,_]');
        for (const [index, field] of defences.entries()) f.player.setVar(pv(field), 113 + index * 101);
        const result = observed(f);
        assert.deepEqual(result.draws, [0.999999, 0, 0.999999]);
        const rolls = result.events.filter(event => event.op === 'RANDOMINC');
        assert.deepEqual(rolls[1].in, [113 + spec.style * 101], `${name} selected native defence cache`);
        assert.deepEqual(rolls[2].in, [spec.maximum], `${name} native maximum, not a JS formula`);
        assert.equal(rt.param(NpcType.get(spec.id), 'damagetype'), spec.style);
        assert.deepEqual(queueDamage(result).map(q => q.args), [[spec.maximum]]);
        assert.equal(result.snapshot.npcVars[delay], 104);
        assert.equal(result.snapshot.playerVars[pv('aggressive_npc')], f.npc.uid);
        assert.equal(result.snapshot.npcVars[nv('npc_attacking_uid')], f.player.uid);
        assert.equal(result.snapshot.queued.filter(q => q.script === '[queue,playerhit_n_retaliate]').length, 1);
        const delivered = rt.settle(f);
        assert.equal(delivered.levels[3], 255 - spec.maximum, 'actual native damage queue reaches the selected player');
        assert.equal(delivered.energy, 10000);
        assert.deepEqual(delivered.levels.filter((_, index) => index !== 3), Array(20).fill(80), 'no invented stat effect');
        assert.deepEqual([...f.npc.levels], [...f.npc.baseLevels], 'attack neither heals nor drains its actor');
      });
      for (const variant of ['zero', 'miss', 'protected', 'pending', 'target-loss', 'npc-busy', 'dead-player', 'dead-npc']) {
        check(`${name} ${variant} keeps native draws and delivery`, () => {
          const f = fixture(name, variant);
          const result = observed(f, variant);
          const noAttempt = ['pending', 'target-loss', 'npc-busy', 'dead-player'].includes(variant);
          const expectedDraws = noAttempt ? 0 : ['miss', 'protected'].includes(variant) ? 2 : 3;
          assert.equal(result.draws.length, expectedDraws);
          assert.equal(queueDamage(result).length, noAttempt || variant === 'dead-npc' ? 0 : 1);
          if (queueDamage(result).length) assert.deepEqual(queueDamage(result)[0].args, [0]);
          if (!noAttempt) assert.equal(result.snapshot.npcVars[delay], 104);
          assert.equal(rt.settle(f).levels[3], variant === 'dead-player' ? 0 : 255);
          if (variant === 'zero') assert(result.visited.includes('[proc,npc_meleeattack_hit]'), 'accurate rolled zero reaches the native hit branch');
          if (variant === 'miss' || variant === 'protected') assert(!result.visited.includes('[proc,npc_meleeattack_hit]'), 'native miss/protected branch rolls no magnitude');
        });
      }
      check(`${name} wounded actor keeps its cap; one living HP does not retreat`, () => {
        const f = fixture(name);
        f.npc.levels[3] = 1;
        f.player.lastAfkZone = 1000;
        const retaliation = rt.observe('[ai_queue1,_]', f);
        assert.equal(retaliation.snapshot.execution, State.FINISHED);
        assert.equal(f.npc.targetOp, NpcMode.OPPLAYER2);
        assert.equal(f.npc.getVar(delay), 102);
        World.currentTick = 102;
        const result = observed(f);
        assert.deepEqual(queueDamage(result).map(q => q.args), [[spec.maximum]]);
        assert.equal(f.npc.levels[3], 1);
      });
      check(`${name} native contact clipping blocks a wall and distance, then attacks adjacent`, () => {
        const f = fixture(name);
        f.npc.setInteraction(Interaction.SCRIPT, f.player, NpcMode.OPPLAYER2);
        routefinder.changeWall(f.npc.x, f.npc.z, 0, routefinder.LocAngle.WEST, routefinder.LocShape.WALL_STRAIGHT, true, true);
        assert.equal(f.npc.tryInteract(true), false);
        assert.equal([...f.player.queue.all()].length, 0);
        assert.equal(f.npc.getVar(delay), 0);
        routefinder.changeWall(f.npc.x, f.npc.z, 0, routefinder.LocAngle.WEST, routefinder.LocShape.WALL_STRAIGHT, true, false);
        f.npc.x += 2;
        assert.equal(f.npc.tryInteract(true), false);
        assert.equal([...f.player.queue.all()].length, 0);
        f.npc.x -= 2;
        assert.equal(f.npc.tryInteract(true), true);
        assert.equal(f.npc.getVar(delay), 104);
        assert.equal([...f.player.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').length, 1);
      });
      check(`${name} maximum-level acquisition, radius, sight, tolerance and re-acquisition`, () => {
        const f = fixture(name, 'hit', BARROWS_HUNT_RADIUS);
        for (let stat = 0; stat < f.player.baseLevels.length; stat++) f.player.setLevel(stat, 99);
        assert.equal(f.player.combatLevel, 126);
        f.npc.setVar(nv('npc_aggressive_player'), 0); // No attack or retaliation seeds acquisition.
        zone = World.gameMap.getZone(f.player.x, f.player.z, 0); zone.enter(f.player);
        const hunt = HuntType.get(f.npc.huntMode);
        assert.equal(hunt.checkNotTooStrong, 0);
        const acquire = () => { f.npc.huntClock = hunt.rate; f.npc.huntAll(hunt); return f.npc.huntTarget; };
        assert.equal(acquire(), f.player, 'native hunt acquires a maximum-level idle player at distance four');
        f.npc.x++;
        assert.equal(acquire(), null, 'outside radius');
        f.npc.x--;
        routefinder.changeLoc(f.player.x + 1, f.player.z, 0, 1, 1, true, true);
        assert.equal(acquire(), null, 'line-of-sight obstruction');
        routefinder.changeLoc(f.player.x + 1, f.player.z, 0, 1, 1, true, false);
        f.player.updateAfkZones();
        assert.equal(f.player.lastAfkZone, 0);
        for (let tick = 0; tick < 999; tick++) f.player.updateAfkZones();
        assert.equal(f.player.zonesAfk(), false);
        assert.equal(acquire(), f.player, 'still acquired at 999 ticks');
        f.player.x++;
        f.player.updateAfkZones();
        assert.equal(f.player.lastAfkZone, 1000, 'movement within tolerance squares does not reset the clock');
        assert.equal(f.player.zonesAfk(), true);
        assert.equal(acquire(), null, '1000 ticks / 600 seconds ends new acquisition');
        f.player.x += 40;
        f.player.updateAfkZones();
        assert.equal(f.player.zonesAfk(), false, 'leaving both tolerance squares resets expiry');
        f.player.x -= 41;
        f.player.updateAfkZones();
        assert.equal(acquire(), f.player, 'native acquisition resumes without changing NPC policy');
        f.npc.consumeHuntTarget();
        assert.equal(f.npc.target, f.player);
        assert.equal(f.npc.targetOp, NpcMode.OPPLAYER2);
        assert.equal(f.npc.huntMode, -1, 'native policy stops seeking a different target during this interaction');
        f.npc.resetDefaults();
        assert.equal(f.npc.huntMode, HuntType.getId('aggressive_melee'), 'native reset restores configured acquisition');
      });
      check(`${name} native regeneration remains exactly 100 ticks for all six skills`, () => {
        const { npc } = fixture(name);
        npc.processRegen(); // Native spawn phase chooses its configured interval.
        assert.equal(npc.regenInterval, 100);
        for (let index = 0; index < 6; index++) npc.levels[index] = npc.baseLevels[index] - 1;
        const drained = [...npc.levels];
        for (let tick = 0; tick < 99; tick++) npc.processRegen();
        assert.deepEqual([...npc.levels], drained);
        npc.processRegen();
        assert.deepEqual([...npc.levels], [...npc.baseLevels]);
        for (let tick = 0; tick < 100; tick++) npc.processRegen();
        assert.deepEqual([...npc.levels], [...npc.baseLevels], 'full actor never over-heals');
      });
    }
    const poison = fs.readFileSync(path.join(contentRoot, 'tests/barrows/test_poison.mjs'), 'utf8');
    assert(poison.includes('[35, 31]'), 'S04 crypt-rat fixture remains exactly [35,31]');
    console.log(`PASS BC-02 ${count} native tunnel cases; unchanged static/removal/credit/D4/poison suites remain registered`);
  } finally {
    if (zone) zone.leave(World.players[1]);
    rt.dispose();
    if (World.players[1]) { World.players[1].unlink(); World.players[1] = null; }
  }
});
