// Shared ordinary cats and the actual advanced-cat reward services.
import assert from 'node:assert/strict';
import {
  World, Npc, EntityLifeCycle, BlockWalk, types, ServerTriggerType as T,
  id, obj, inv, bank, v, b, player, run, held, button, cat, target, interact,
  count, add, fill, makeSpace, nativeNpcRows, load, withRandom
} from './runtime.mjs';
const { NpcStat } = await load('engine/entity/NpcStat.ts');
const felkrash = target('npc', 'vc_felkrash_the_bard');
const talk = (p, choice) => interact(p, felkrash, T.OPNPC1, null, [choice]);
const colours = ['', '_light', '_brown', '_black', '_browngrey', '_bluegrey'];
for (const suffix of colours) {
  for (const [name, expected] of [[suffix ? `kittenpet${suffix}` : 'kittenpet1', [4, 1, 1, 0]], [`growncat${suffix}`, [6, 4, 3, 0]]]) {
    const config = types.NpcType.get(id('NpcType', name));
    assert.deepEqual([NpcStat.HITPOINTS, NpcStat.ATTACK, NpcStat.STRENGTH, NpcStat.DEFENCE].map(stat => config.stats[stat]), expected, `${name} server-only candidate combat profile`);
  }
  const p = player({ cat: `overgrowncat${suffix}` }); p.setVarBit(b('ratcatch_var'), 127);
  const original = cat(p); talk(p, 1);
  assert.equal(cat(p), original, 'training changes the owned NPC, not a second cosmetic cat');
  assert.equal(cat(p).type, id('NpcType', `wileycat${suffix}`));
  assert.equal(p.getVar(v('follower_obj')), obj(`wileycatobject${suffix}`));
  assert.equal(cat(p).baseLevels[NpcStat.HITPOINTS], 12, 'real stats change with advanced form');
  p.setVar(v('cat_growth'), 19 << 11); run(p, '[ai_timer,_ratcatch_petcat]', [], cat(p));
  assert.equal(cat(p).type, id('NpcType', `wileycat${suffix}`), 'wily age threshold is bounded');
  p.setVar(v('cat_growth'), 20 << 11); run(p, '[ai_timer,_ratcatch_petcat]', [], cat(p));
  assert.equal(cat(p).type, id('NpcType', `lazycat${suffix}`));
  assert.equal(cat(p).baseLevels[NpcStat.HITPOINTS], 14);
  p.setVar(v('cat_growth'), (4 << 11) | (14 << 20)); run(p, '[ai_timer,_ratcatch_petcat]', [], cat(p));
  assert.equal(cat(p).type, id('NpcType', `lazycat${suffix}`), 'four intervals alone cannot retrain without fifteen catches');
  p.setVar(v('cat_growth'), (3 << 11) | (15 << 20)); run(p, '[ai_timer,_ratcatch_petcat]', [], cat(p));
  assert.equal(cat(p).type, id('NpcType', `lazycat${suffix}`), 'fifteen catches alone cannot bypass the age interval');
  p.setVar(v('cat_growth'), (4 << 11) | (15 << 20)); run(p, '[ai_timer,_ratcatch_petcat]', [], cat(p));
  assert.equal(cat(p).type, id('NpcType', `wileycat${suffix}`));
  assert.equal(p.getVar(v('cat_growth')), 0, 'retraining resets only the existing activity clock');
  const foreign = player({ cat: null });
  interact(foreign, { entity: cat(p), stand: [p.level, p.x, p.z] }, T.OPNPC1);
  assert.equal(cat(p), original); assert.equal(count(foreign, `wileycatobject${suffix}`), 0, 'another player cannot pick up the follower');
  fill(p); interact(p, { entity: cat(p), stand: [p.level, p.x, p.z] }, T.OPNPC1);
  assert.equal(cat(p), original, 'full inventory leaves the cat in the world');
  makeSpace(p); interact(p, { entity: cat(p), stand: [p.level, p.x, p.z] }, T.OPNPC1);
  assert.equal(p.getVar(v('follower_uid')), -1); assert.equal(count(p, `wileycatobject${suffix}`), 1);
  held(p, `wileycatobject${suffix}`, 5); assert.equal(cat(p).type, id('NpcType', `wileycat${suffix}`));
}
{
  const p = player({ cat: 'overgrowncat' });
  run(p, '[proc,ratcatch_cat_services]'); assert.equal(cat(p).type, id('NpcType', 'overgrowncat'), 'training is locked before completion');
  p.setVarBit(b('ratcatch_var'), 127); add(p, 'lazycatobject', 1, bank); talk(p, 1);
  assert.equal(cat(p).type, id('NpcType', 'overgrowncat'), 'a stored advanced cat prevents duplicate training');
}

// Name encoding touches no original rat flags, flute notes, page state or retreat bit, including signed base varps.
const p = player({ cat: 'wileycat' });
p.setVar(v('main_ratcatch_var'), 0x1fffffff);
p.setVar(v('ratcatch_var_multi'), 0x1fff);
p.setVar(v('ratcatch_var_temp1'), 0x0fffffff);
p.setVar(v('ratcatch_var_temp2'), 0x2fffffff);
const before = ['main_ratcatch_var', 'ratcatch_var_multi', 'ratcatch_var_temp1', 'ratcatch_var_temp2'].map(name => p.getVar(v(name)));
for (const value of [0, 1, 1 << 18, 1 << 19, 1 << 21, 1 << 22, 1 << 25, 1 << 26, 1 << 27, 1 << 28, 27 ** 6 - 1]) {
  run(p, '[proc,ratcatch_name_store]', [value]);
  assert.equal(run(p, '[proc,ratcatch_name_value]').popInt(), value, `name value ${value} round-trips`);
  const masks = [0x1fffffff, 0x1fff, 0x0fffffff, 0x2fffffff];
  for (const [i, name] of ['main_ratcatch_var', 'ratcatch_var_multi', 'ratcatch_var_temp1', 'ratcatch_var_temp2'].entries()) {
    assert.equal(p.getVar(v(name)) & masks[i], before[i] & masks[i], `${name} occupied bits remain intact`);
  }
}
const nameValue = run(p, '[proc,ratcatch_name_value]').popInt();
for (let page = 0; page < 8; page++) run(p, '[proc,ratcatch_note_set]', [page, page * 11]);
assert.equal(run(p, '[proc,ratcatch_name_value]').popInt(), nameValue, 'editing all eight notes preserves the name');
run(p, '[proc,ratcatch_name_store]', [0]); talk(p, 2);
assert.equal(p.modalMain, id('Component', 'name_your_cat'));
for (const [slot, minus, plus] of [[0, 17, 18], [1, 19, 20], [2, 21, 22], [3, 23, 24], [4, 25, 26], [5, 28, 27]]) {
  button(p, `name_your_cat:com_${minus}`);
  assert.equal(run(p, '[proc,ratcatch_name_letter]', [slot]).popString(), ' ', 'minus wraps A to space');
  button(p, `name_your_cat:com_${plus}`); button(p, `name_your_cat:com_${plus}`);
  assert.equal(run(p, '[proc,ratcatch_name_letter]', [slot]).popString(), 'B', 'every native plus wheel controls its own letter');
}
button(p, 'name_your_cat:com_31'); assert.equal(run(p, '[proc,ratcatch_cat_name]').popString(), 'BBBBBB');
run(p, '[proc,follower_logout]');
const saved = p.vars.slice(); const reloaded = player({ cat: null }); reloaded.vars.set(saved);
run(reloaded, '[queue,follower_login]');
assert.equal(cat(reloaded).type, id('NpcType', 'wileycat'));
assert.equal(run(reloaded, '[proc,ratcatch_cat_name]').popString(), 'BBBBBB', 'serialized original varps preserve all six letters');

// The approved hooks do not change ordinary growth thresholds or kitten/grown catch probabilities.
for (const [kind, threshold, next] of [['kittenpet1', 120, 'growncat'], ['growncat', 320, 'overgrowncat']]) {
  const q = player({ cat: kind }); q.setVar(v('cat_growth'), (threshold - 1) << 11);
  run(q, '[timer,petcat_growth]'); assert.equal(cat(q).type, id('NpcType', next));
}
const row = nativeNpcRows('rat').find(r => r.level === 0 && r.z < 9000);
assert(row);
for (const [kind, expected] of [['kittenpet1', 0], ['growncat', 1]]) {
  const q = player({ cat: kind });
  const prey = new Npc(row.level, row.x, row.z, 1, 1, EntityLifeCycle.RESPAWN, World.getNextNid(), row.id, BlockWalk.NONE);
  World.addNpc(prey, -1);
  const rat = target('npc', 'rat', () => row); const owned = cat(q); [owned.level, owned.x, owned.z] = rat.stand;
  withRandom(0.15, () => assert.equal(interact(q, { entity: owned, stand: rat.stand }, T.OPNPC5), '[opnpc5,_petcat]'));
  assert.equal((q.getVar(v('cat_growth')) >>> 20) & 127, expected, `${kind} keeps its original 10%/50% roll`);
}

// Real advanced-cat Chase action, failure/success and the fifteenth retraining catch.
for (const [kind, growth, randomValue, expected] of [
  ['wileycat', 0, 0.4, 1], ['lazycat', (4 << 11) | (14 << 20), 0.4, 14],
  ['lazycat', (4 << 11) | (14 << 20), 0, 15]
]) {
  const q = player({ cat: kind }); q.setVarBit(b('ratcatch_var'), 127); q.setVar(v('cat_growth'), growth);
  const prey = new Npc(row.level, row.x, row.z, 1, 1, EntityLifeCycle.RESPAWN, World.getNextNid(), row.id, BlockWalk.NONE);
  World.addNpc(prey, -1);
  const fixture = target('npc', 'rat', () => row); const owned = cat(q);
  [owned.level, owned.x, owned.z] = fixture.stand;
  withRandom(randomValue, () => interact(q, { entity: owned, stand: fixture.stand }, T.OPNPC4, null, [2]));
  assert.equal((q.getVar(v('cat_growth')) >>> 20) & 127, expected);
  if (expected === 15) {
    run(q, '[ai_timer,_ratcatch_petcat]', [], cat(q));
    assert.equal(cat(q).type, id('NpcType', 'wileycat'), 'real fifteenth catch completes lazy retraining');
  }
}
console.log('Rat Catchers cats: twelve shared profiles, all advanced colours, ownership, pickup/drop, training, naming persistence and normal growth/catching passed');
process.exit(0);
