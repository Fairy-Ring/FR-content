import assert from 'node:assert/strict';
import { createRunner, loadPackedRuntime, parseEnum, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { ScriptProvider, ScriptRunner, ScriptState, JavaRandom, EnumType, ObjType } = runtime;
  const runner = createRunner(runtime, { prefix: 'barrows_reward' });
  const player = runner.makePlayer('math');
  const scripts = new Map();
  function native(name, args) {
    let script = scripts.get(name);
    if (!script) {
      script = ScriptProvider.getByName(`[proc,${name}]`);
      assert(script, `S11 needs the compiled ${name} reward function`);
      scripts.set(name, script);
    }
    const state = ScriptRunner.init(script, player, null, args);
    assert.equal(ScriptRunner.execute(state), ScriptState.FINISHED, `${name} must finish without suspension`);
    return state;
  }
  const integer = (name, args) => {
    const state = native(name, args);
    assert.equal(state.isp, 1);
    return state.intStack[0];
  };
  // Independent D6 oracle: inclusive bounds and exact rational floors from the
  // accepted plan, not parsed from the implementation's constants or scripts.
  const bands = [
    ['coins', 380, 2, 1], ['mindrune', 505, 2, 3], ['chaosrune', 630, 2, 9],
    ['deathrune', 755, 1, 9], ['bloodrune', 880, 1, 20], ['barrows_karil_ammo', 1005, 1, 25],
    ['keyhalf2', 1008, 0, 1], ['keyhalf1', 1011, 0, 1], ['dragon_med_helm', 1012, 0, 1]
  ];
  const oracle = [[-1, 0]];
  for (let R = 1; R <= 1012; R++) {
    const [name, , numerator, denominator] = bands.find(([, high]) => R <= high);
    const id = ObjType.getId(name);
    assert.notEqual(id, -1, `original reward ${name}`);
    oracle.push([id, numerator === 0 ? 1 : Math.floor(numerator * R / denominator)]);
  }
  const empty = native('barrows_reward_quantity', [0]);
  assert.equal(empty.isp, 2);
  assert.deepEqual(empty.intStack.slice(0, 2), oracle[0], 'P=0 yields no ordinary item');
  let quantityCases = 0;
  for (let B = 0; B <= 6; B++) for (let C = 0; C <= 1000; C++) {
    const P = C + 2 * B;
    for (let R = 1; R <= P; R++) {
      const state = native('barrows_reward_quantity', [R]);
      assert.equal(state.isp, 2);
      if (state.intStack[0] !== oracle[R][0] || state.intStack[1] !== oracle[R][1]) {
        assert.deepEqual(state.intStack.slice(0, 2), oracle[R], `D6 quantity B=${B} C=${C} R=${R}`);
      }
      quantityCases++;
    }
  }
  assert.equal(quantityCases, 3545542, 'the complete specified B/C/R domain is enumerated');
  console.log(`PASS S11 quantities: ${quantityCases} native cases plus P=0`);

  const names = ['ahrim', 'dharok', 'guthan', 'karil', 'torag', 'verac']
    .flatMap(brother => ['head', 'body', 'legs', 'weapon'].map(piece => `barrows_${brother}_${piece}`));
  const config = parseEnum(runtime.contentRoot, 'barrows_reward_gear');
  const packed = EnumType.get(EnumType.getId('barrows_reward_gear'));
  assert.equal(config.size, 24, 'exactly the 24 unsuffixed fresh original pieces');
  names.forEach((name, rank) => {
    assert.equal(config.get(String(rank)), name, `stable fresh gear rank ${rank}`);
    assert.equal(packed.values.get(rank), ObjType.getId(name), `packed original identity ${name}`);
    assert.equal(ObjType.get(ObjType.getId(name)).stackable, false, 'fresh equipment uses original unstackability');
  });
  for (const [name] of bands) {
    assert.equal(ObjType.get(ObjType.getId(name)).stackable, bands.findIndex(row => row[0] === name) < 6,
      `original stackability ${name}`);
  }
  for (let mask = 0; mask < 64; mask++) {
    let expected = 0;
    for (let bit = 0; bit < 6; bit++) if (mask & (1 << bit)) expected |= 15 << (4 * bit);
    const pool = integer('barrows_reward_pool', [mask]);
    assert.equal(pool, expected, `only credited identities enter the pool mask=${mask}`);
    const remaining = names.map((_, rank) => rank).filter(rank => pool & (1 << rank));
    remaining.forEach((piece, rank) => {
      assert.equal(integer('barrows_reward_rank', [pool, rank]), piece, 'initial conditional rank');
      const depleted = pool & ~(1 << piece);
      const after = remaining.filter(other => other !== piece);
      after.forEach((other, nextRank) => {
        assert.equal(integer('barrows_reward_rank', [depleted, nextRank]), other,
          `exact removal and rank remap mask=${mask} piece=${piece} rank=${nextRank}`);
      });
      assert.equal(after.filter(other => Math.floor(other / 4) === Math.floor(piece / 4)).length, 3,
        'removing a piece retains the other three pieces of that brother');
    });
  }
  console.log('PASS S11 all slain masks, exact fresh joins and single-removal/rank remapping');

  const trials = 1200000;
  const denominators = [null, 392, 334, 276, 218, 160, 102];
  for (let B = 0; B <= 6; B++) {
    JavaRandom.setSeed(0x377B0000 | B);
    let successes = 0;
    for (let trial = 0; trial < trials; trial++) successes += integer('barrows_reward_equipment', [B]);
    if (B === 0) assert.equal(successes, 0, 'B=0 has exactly no equipment branch');
    else assert(Math.abs(successes - trials / denominators[B]) <= 720,
      `Bernoulli B=${B}: ${successes}/${trials} differs from 1/${denominators[B]} by more than 720`);
    console.log(`PASS S11 Bernoulli B=${B} seed=${0x377B0000 | B} successes=${successes}/${trials} denominator=${denominators[B]}`);
  }
  for (let M = 1; M <= 24; M++) {
    JavaRandom.setSeed(0x377C0000 | M);
    const counts = new Array(M).fill(0);
    const pool = (1 << M) - 1;
    for (let trial = 0; trial < trials; trial++) {
      const piece = integer('barrows_reward_piece', [pool]);
      assert(piece >= 0 && piece < M, `rank remains in its exact eligible pool M=${M}`);
      counts[piece]++;
    }
    for (const [piece, count] of counts.entries()) {
      assert(Math.abs(count - trials / M) <= 3600, `conditional rank M=${M} piece=${piece} count=${count} outside tolerance 3600`);
    }
    console.log(`PASS S11 conditional rank M=${M} seed=${0x377C0000 | M} counts=${counts.join(',')}`);
  }

  const original = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => 0;
  try {
    let pool = integer('barrows_reward_pool', [63]);
    const selected = [];
    for (let win = 0; win < 24; win++) {
      const state = native('barrows_reward_roll', [6, 1000, pool]);
      assert.equal(state.isp, 3);
      const [item, quantity, after] = state.intStack;
      assert.equal(item, ObjType.getId(names[win]), 'forced wins follow the remaining conditional ranks');
      assert.equal(quantity, 1);
      assert.equal(after, pool & ~(1 << win), 'a win removes exactly its selected piece');
      selected.push(item);
      pool = after;
    }
    assert.equal(new Set(selected).size, 24, 'forced multiple wins never repeat an exact piece');
    assert.equal(pool, 0);
    const fallback = native('barrows_reward_roll', [6, 1000, pool]);
    assert.deepEqual(fallback.intStack.slice(0, fallback.isp), [ObjType.getId('coins'), 2, 0], 'empty gear pool falls through to the ordinary branch');
    const zero = native('barrows_reward_roll', [0, 0, 0]);
    assert.deepEqual(zero.intStack.slice(0, zero.isp), [-1, 0, 0], 'B=0/C=0 has no reward and no gear');
    let coins = 0;
    for (let roll = 0; roll < 7; roll++) {
      const state = native('barrows_reward_roll', [6, 1000, 0]);
      assert.equal(state.intStack[0], ObjType.getId('coins'));
      coins += state.intStack[1];
    }
    assert.equal(coins, 14, 'repeated ordinary stack results retain their exact additive quantities');
  } finally {
    JavaRandom.nextDouble = original;
  }
  console.log('PASS S11 forced multiple wins, exact pool exhaustion/fallback and additive stack data');
});
