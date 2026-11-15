import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, Player, LocType, NpcType, VarPlayerType, VarNpcType, InvType, ObjType,
    ScriptRunner, ScriptState, JavaRandom } = runtime;
  const { default: ServerTriggerType } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ServerTriggerType.ts')).href);
  const { default: ScriptPointer } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ScriptPointer.ts')).href);
  const { unzipSync } = createRequire(path.join(runtime.engineRoot, 'package.json'))('fflate');
  const maps = unzipSync(fs.readFileSync(path.join(runtime.packDir, '.cache/maps-server.zip')));
  const square = Object.fromEntries(['m', 'l', 'n', 'o'].map(kind => [kind, maps[`${kind}55_151`] ?? new Uint8Array()]));
  World.gameMap.packed.set((55 << 8) | 151, square);
  World.gameMap.zonemap.beginInitialization();
  World.gameMap.loadPackedMapsquare(square, 55 << 6, 151 << 6);
  World.gameMap.zonemap.endInitialization();
  const chest = World.getLoc(3551, 9695, 0, LocType.getId('barrows_stone_chest'));
  assert(chest, 'the native original parent chest is loaded');
  const runner = createRunner(runtime, { prefix: 'barrows_grant' });
  const vars = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns'].map(name => [name, VarPlayerType.getId(name)]));
  const invId = InvType.getId('inv');
  const id = name => ObjType.getId(name);
  const grantPolicy = fs.readFileSync(path.join(runtime.contentRoot, 'scripts/minigames/game_barrows/configs/barrows.constant'), 'utf8')
    .match(/^\^barrows_grant_order\s*=\s*(".*")\s*$/m);
  assert(grantPolicy, 'S12 names its UNKNOWN engineering BARROWS_GRANT_ORDER in config');
  const [stackOrder, singleOrder] = JSON.parse(grantPolicy[1]).split(';');
  assert.deepEqual(stackOrder.split(','), ['coins', 'mindrune', 'chaosrune', 'deathrune', 'bloodrune', 'barrows_karil_ammo']);
  assert.equal(singleOrder, 'singles_in_roll_order');
  const players = [];
  function fixture(mask = 1, potential = 1000) {
    const serial = players.length + 1;
    const p = new Player(`barrows_grant_${serial}`, BigInt(serial), 0x190000000000000n + BigInt(serial));
    [p.level, p.x, p.z] = [0, 3551, 9694];
    p.slot = p.pid = serial;
    p.uid = (Number(p.username37 & 0x1fffffn) << 11) | serial;
    p.isActive = true;
    p.lastMovement = 0;
    p.messages = [];
    p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.messages.push(text);
    p.wrappedMessageGame = text => p.messages.push(text);
    World.players[serial] = p;
    World.playerLoop.add(0x76000000n + BigInt(serial), p);
    players.push(p);
    p.getInventory(InvType.getId('worn'));
    p.setVar(vars.barrows, 0xd2345678);
    p.setVar(vars.barrows_state, 0xa5000000 | 1 | (1 << 3) | (2 << 5) | (1 << 7) | (1 << 9) | (2 << 10) | (5 << 12));
    p.setVar(vars.barrows_kills, (11 << 17) | (1 << 16) | (potential << 6) | mask);
    p.setVar(vars.barrows_generation, 71);
    p.setVar(vars.barrows_countdowns, 0);
    return p;
  }
  const stateWords = p => Object.fromEntries(Object.entries(vars).map(([name, key]) => [name, p.getVar(key) >>> 0]));
  const inventory = p => Array.from({ length: 28 }, (_, slot) => {
    const obj = p.getInventory(invId).get(slot);
    return obj ? [obj.id, obj.count] : null;
  });
  let activeSearch = null;
  let beforeSearch = null;
  function search(p) {
    p.target = chest;
    p.targetOp = ServerTriggerType.OPLOC1 - 7;
    const trigger = p.getOpTrigger();
    if (!trigger) { p.defaultOp(); return null; }
    assert.equal(trigger.name, '[oploc1,barrows_stone_chest_open]', 'Search dispatches through the original shown open child');
    const state = ScriptRunner.init(trigger, p, chest, []);
    activeSearch = state;
    beforeSearch = stateWords(p);
    try { p.executeScript(state, true); }
    finally { activeSearch = beforeSearch = null; }
    assert.equal(state.execution, ScriptState.FINISHED, 'the complete native Search must not suspend');
    assert.equal(p.activeScript, null);
    assert.equal(p.delayed, false);
    assert.equal(p.protect, false);
    return state;
  }
  function withDraws(draws, action) {
    const saved = JavaRandom.nextDouble;
    let count = 0;
    JavaRandom.nextDouble = () => {
      assert(count < draws.length, 'Search consumes no extra random draw');
      assert.deepEqual(stateWords(activeSearch._activePlayer), beforeSearch, 'S12 every reward draw precedes the latch and any durable write');
      return draws[count++];
    };
    try {
      const result = action();
      assert.equal(count, draws.length, 'Search consumes exactly the complete snapshot roll sequence');
      return result;
    } finally { JavaRandom.nextDouble = saved; }
  }
  function ordinaryDraws(B, C, rolls) {
    return rolls.flatMap(R => [...(B ? [0.999999] : []), (R - 0.5) / (C + 2 * B)]);
  }
  function assertPaid(p, before, label) {
    const after = stateWords(p);
    assert.equal((after.barrows_state >>> 3) & 3, 2, `${label}: valid Search must pay even below six brothers`);
    assert.equal(after.barrows_generation, before.barrows_generation + 1, `${label}: payment advances the generation`);
    assert.equal(after.barrows_kills, before.barrows_kills, `${label}: all credit and chest-open bits freeze`);
    assert.equal(after.barrows, before.barrows, `${label}: every original layout/puzzle bit remains unchanged`);
    assert.equal(after.barrows_state, ((before.barrows_state & ~0xfe18) | (2 << 3)) >>> 0, `${label}: only phase and challenge scratch fields change`);
  }
  const originalAddObj = World.addObj;
  const ground = [];
  World.addObj = function (obj, owner, duration) {
    ground.push({ id: obj.type, count: obj.count, owner, level: obj.level, x: obj.x, z: obj.z, duration });
    return originalAddObj.call(this, obj, owner, duration);
  };
  try {
    const partial = fixture(1, 1);
    const partialBefore = stateWords(partial);
    // B=1 gives two rolls. Both are ordinary coin R=1; no final-death gate.
    withDraws(ordinaryDraws(1, 1, [1, 1]), () => {
      search(partial);
      assertPaid(partial, partialBefore, 'S12 partial-B');
    });
    assert.equal(partial.invTotal(invId, id('coins')), 4, 'S12 partial-B Search gives the real summed quantity');

    const expectedQuantities = { coins: 762, mindrune: 254, chaosrune: 112, deathrune: 70, bloodrune: 37, barrows_karil_ammo: 35 };
    const expectedStacks = stackOrder.split(',').map(name => [id(name), expectedQuantities[name]]);
    for (const mergedCoins of [false, true]) {
      const p = fixture(63, 1000);
      if (mergedCoins) assert.equal(p.invAdd(invId, id('coins'), 37), 37);
      assert.equal(p.invAdd(invId, id('spade'), mergedCoins ? 27 : 26), mergedCoins ? 27 : 26);
      const before = stateWords(p);
      const own = runner.addNpc('barrows_guthan', 0, p.uid, 3554, 9694).npc;
      own.setVar(VarNpcType.getId('npc_barrows_generation'), before.barrows_generation);
      const foreign = runner.addNpc('barrows_guthan', 0, p.uid + 10000, 3554, 9693).npc;
      foreign.setVar(VarNpcType.getId('npc_barrows_generation'), before.barrows_generation);
      const grants = [];
      const original = p.invAdd;
      p.invAdd = function (container, obj, count, ...rest) {
        if (container === invId) {
          assert.equal(activeSearch?.pointerGet(ScriptPointer.ProtectedActivePlayer), true, 'S12 the real native grant retains its protected script pointer');
          assertPaid(this, before, 'S12 each grant observes the latched transaction');
          assert.equal(own.isActive, false, 'S12 owned actor removal precedes every grant');
          assert.equal(foreign.isActive, true, 'S12 the other owner survives payment');
          grants.push([obj, count]);
        }
        return original.call(this, container, obj, count, ...rest);
      };
      const groundAt = ground.length;
      try { withDraws(ordinaryDraws(6, 1000, [881, 756, 631, 506, 381, 380, 1]), () => search(p)); }
      finally { p.invAdd = original; }
      assertPaid(p, before, 'S12 stack order');
      assert.deepEqual(grants, expectedStacks, 'S12 BARROWS_GRANT_ORDER sums stacks before granting them in band order');
      const overflow = ground.slice(groundAt);
      assert.deepEqual(overflow.map(({ id, count }) => [id, count]), expectedStacks.slice(mergedCoins ? 1 : 2), 'S12 real overflow keeps grant order');
      assert(overflow.every(row => row.owner === p.hash64 && row.level === p.level && row.x === p.x && row.z === p.z), 'S12 overflow is native owned floor at the player');
      assert.equal(p.invTotal(invId, id('coins')), 762 + (mergedCoins ? 37 : 0), 'S12 original stack merges without requiring a slot');
      const repeatWords = stateWords(p);
      const repeatInv = inventory(p);
      const repeatGround = ground.length;
      withDraws([], () => search(p));
      assert.deepEqual(stateWords(p), repeatWords, 'S12 repeat Search mutates no durable field');
      assert.deepEqual(inventory(p), repeatInv, 'S12 repeat Search pays no inventory item');
      assert.equal(ground.length, repeatGround, 'S12 repeat Search pays no floor item');
      runner.procVoid(p, 'barrows_credit', [before.barrows_generation, NpcType.getId('barrows_ahrim'), 98]);
      runner.procVoid(p, 'barrows_credit', [p.getVar(vars.barrows_generation), NpcType.getId('barrows_rat'), 43]);
      assert.equal(p.getVar(vars.barrows_kills) >>> 0, before.barrows_kills, 'S12 both stale and current-generation paid kills are frozen');
      if (foreign.isActive) World.removeNpc(foreign, -1);
    }
    console.log('PASS S12 protected whole grant, exact stack consolidation/order, merging, native owned overflow, actor cleanup, freeze and repeat');

    const singles = fixture(63, 1000);
    assert.equal(singles.invAdd(invId, id('spade'), 28), 28);
    const singleBefore = stateWords(singles);
    const singleAt = ground.length;
    const draws = [0.999999, 1005.5 / 1012, 0, 1.5 / 24, 0.999999, 1008.5 / 1012,
      0.999999, 1005.5 / 1012, 0, 0.5 / 23, 0.999999, 1011.5 / 1012, 0.999999, 1008.5 / 1012];
    withDraws(draws, () => search(singles));
    assertPaid(singles, singleBefore, 'S12 singles');
    assert.deepEqual(ground.slice(singleAt).map(({ id: item, count }) => [item, count]),
      ['keyhalf2', 'barrows_ahrim_body', 'keyhalf1', 'keyhalf2', 'barrows_ahrim_head', 'dragon_med_helm', 'keyhalf1'].map(name => [id(name), 1]),
      'S12 ordinary singles may repeat; distinct gear and singles overflow in original roll order');

    const zero = fixture(0, 0);
    const zeroBefore = stateWords(zero);
    withDraws([], () => search(zero));
    assertPaid(zero, zeroBefore, 'S12 zero potential');
    assert(inventory(zero).every(item => item === null), 'S12 P=0 grants no invented fallback');
    for (const mask of Array.from({ length: 64 }, (_, index) => index)) {
      const p = fixture(mask, 1);
      const B = mask.toString(2).replaceAll('0', '').length;
      const before = stateWords(p);
      withDraws(ordinaryDraws(B, 1, new Array(B + 1).fill(1)), () => search(p));
      assertPaid(p, before, `S12 mask ${mask}`);
      assert.equal(p.invTotal(invId, id('coins')), 2 * (B + 1), `S12 mask ${mask}: exact B+1 rolls`);
    }
    for (const scenario of ['closed', 'unsolved', 'idle', 'paid', 'wrong-side', 'crypt', 'outside', 'zero-generation']) {
      const p = fixture();
      if (scenario === 'closed') p.setVar(vars.barrows_kills, p.getVar(vars.barrows_kills) & ~(1 << 16));
      if (scenario === 'unsolved') p.setVar(vars.barrows_state, p.getVar(vars.barrows_state) & ~(1 << 9));
      if (scenario === 'idle' || scenario === 'paid') p.setVar(vars.barrows_state, (p.getVar(vars.barrows_state) & ~24) | (scenario === 'paid' ? 16 : 0));
      if (scenario === 'wrong-side') p.z = 9698;
      if (scenario === 'crypt') p.level = 3;
      if (scenario === 'outside') [p.x, p.z] = [3565, 3289];
      if (scenario === 'zero-generation') p.setVar(vars.barrows_generation, 0);
      const before = stateWords(p);
      const invBefore = inventory(p);
      const floorBefore = ground.length;
      withDraws([], () => runner.procVoid(p, 'barrows_chest_search', [chest.type, runtime.CoordGrid.packCoord(0, 3551, 9695)]));
      assert.deepEqual(stateWords(p), before, `S12 ${scenario}: guarded Search has no field writes`);
      assert.deepEqual(inventory(p), invBefore, `S12 ${scenario}: guarded Search has no grant`);
      assert.equal(ground.length, floorBefore);
    }
    console.log('PASS S12 original single-item roll order, duplicate keys, all 64 masks/B+1 rolls, P=0 and pure refusal guards');
  } finally {
    World.addObj = originalAddObj;
    runner.removeFixtures();
    for (const p of players) {
      if (World.players[p.slot] === p) delete World.players[p.slot];
      p.unlink();
      p.isActive = false;
    }
  }
});
