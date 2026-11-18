#!/usr/bin/env node
// N617: real dispatch and interpreter. No server, saved bytecode or pack IDs.
import assert from 'node:assert/strict';
import { World, ScriptProvider, ScriptState, ServerTriggerType, PlayerStat, types,
  map, engineModule, id, obj, inv, player, inventory, count } from '../swamp-caves/runtime.mjs';

const Runner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { ScriptOpcode } = await engineModule('engine/script/ScriptOpcode.ts');
const { getExpByLevel } = await engineModule('engine/entity/Player.ts');
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const actionDelay = id('VarPlayerType', 'action_delay');
const xp = p => p.stats[PlayerStat.FISHING];
const methods = {
  rarefish: [
    { option: 1, level: 40, tool: 'lobster_pot', products: [['raw_lobster', 900]], message: 'You need at least 40 Fishing to catch Lobsters.' },
    { option: 3, level: 35, tool: 'harpoon', products: [['raw_tuna', 800], ['raw_swordfish', 1000]], secondary: 50, message: 'You need at least 35 Fishing to harpoon these fish.' }
  ],
  memberfish: [
    { option: 1, level: 16, tool: 'big_net', products: [['raw_mackerel', 400], ['raw_cod', 450], ['raw_bass', 1000]], bigNet: true, message: 'You need at least 16 Fishing to catch these fish.' },
    { option: 3, level: 76, tool: 'harpoon', products: [['raw_shark', 1100]], message: 'You need at least 76 Fishing to harpoon these fish.' }
  ]
};
const spots = [
  { name: '52_59_rarefish', category: 'rarefish', placements: 3, options: ['Cage', null, 'Harpoon', 'hidden', 'hidden'] },
  { name: '0_54_49_memberfish', category: 'memberfish', placements: 12, options: ['Net', null, 'Harpoon', 'hidden', 'hidden'] },
  { name: '0_55_49_memberfish', category: 'memberfish', placements: 9, options: ['Net', null, 'Harpoon', 'hidden', 'hidden'] }
];
let cases = 0, failures = 0;
function test(name, body) {
  cases++;
  try { body(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
function fixture(type, level, items = []) {
  const p = player();
  p.level = 0; p.x = 3155; p.z = 9544;
  p.baseLevels[PlayerStat.FISHING] = level;
  p.levels[PlayerStat.FISHING] = level;
  p.stats[PlayerStat.FISHING] = getExpByLevel(level);
  for (const item of items) p.invAdd(inv, obj(item), 1);
  const t = types.NpcType.get(type);
  const n = new Npc(0, p.x - 1, p.z, t.size, t.size, EntityLifeCycle.DESPAWN, World.npcs.next(), type, t.blockwalk);
  World.addNpc(n, -1);
  return { p, n };
}
function dispose({ p, n }) {
  p.delayed = false; p.activeScript = null; p.clearInteraction();
  p.isActive = false; World.players[p.pid] = null; p.unlink(); World.removeNpc(n, -1);
}
function frame(p) {
  p.resetEntity(false); World.currentTick++;
  if (p.delayed && World.currentTick >= p.delayedUntil) p.delayed = false;
  if (!p.delayed && p.activeScript?.execution === ScriptState.SUSPENDED) p.executeScript(p.activeScript, true, true);
  p.processQueues(); p.processEngineQueue(); p.processInteraction();
}
function begin(p, n, option) {
  p.clearPendingAction(); p.originX = p.x; p.originZ = p.z;
  p.setInteraction(Interaction.ENGINE, n, ServerTriggerType.APNPC1 + option - 1);
  p.opcalled = true; p.processInteraction();
}
function texts(p) {
  return [...p.messages, ...p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text)];
}
// Control the RNG input, not STAT_RANDOM's native interpolation or settlement.
// Each case still enters the engine-selected NPC operation and hidden continuation.
let watch = null, outcome = 'success', rolls = 0;
const nativeStatRandom = Runner.HANDLERS[ScriptOpcode.STAT_RANDOM];
Runner.HANDLERS[ScriptOpcode.STAT_RANDOM] = state => {
  if (state._activePlayer !== watch || !['[proc,fish_roll]', '[proc,fish_roll_big_net]'].includes(state.script.name)) return nativeStatRandom(state);
  const previous = JavaRandom.nextDouble;
  const draw = outcome === 'failure' || (outcome === 'fallback' && rolls++ % 2 === 0) ? 255 / 256 : 0;
  JavaRandom.nextDouble = () => draw;
  try { return nativeStatRandom(state); } finally { JavaRandom.nextDouble = previous; }
};
function run(f, method, ticks = 18, mode = 'success') {
  JavaRandom.setSeed(0); watch = f.p; outcome = mode; rolls = 0;
  const trace = [];
  try {
    begin(f.p, f.n, method.option);
    for (let tick = 1; tick <= ticks; tick++) {
      frame(f.p);
      trace.push({ tick, inventory: inventory(f.p), xp: xp(f.p), messages: [...texts(f.p)],
        option: f.p.target ? f.p.targetOp : null, delay: f.p.getVar(actionDelay) - World.currentTick,
        packets: f.p.packets.filter(packet => packet.constructor.name === 'SynthSound').map(packet => ({ synth: packet.synth, loops: packet.loops, delay: packet.delay })) });
    }
  } finally { watch = null; }
  return trace;
}
function reference(category) {
  const t = types.NpcType.configs.find(t => t?.category === id('CategoryType', category) && t.params?.get(id('ParamType', 'is_whirlpool')) !== 1);
  assert(t, `published ${category} control`); return t.id;
}
function equipmentMessage(tool) {
  const struct = types.ObjType.get(obj(tool)).params.get(id('ParamType', 'fish_equipment_struct'));
  return types.StructType.get(struct).params.get(id('ParamType', 'fish_equipment_failmessage'));
}
function refusal(spot, method, level, items, message) {
  const f = fixture(id('NpcType', spot.name), level, items);
  try {
    const before = inventory(f.p), beforeXp = xp(f.p);
    run(f, method, 10);
    assert(texts(f.p).includes(message), JSON.stringify(texts(f.p)));
    assert.deepEqual(inventory(f.p), before); assert.equal(xp(f.p), beforeXp);
  } finally { dispose(f); }
}
try {
  for (const spot of spots) {
    const type = id('NpcType', spot.name), t = types.NpcType.get(type);
    test(`${spot.name}: cache options, stationarity and dispatch on every visible/hidden operation`, () => {
      assert.deepEqual(t.op, spot.options); assert.equal(t.category, -1); assert.equal(t.timer, -1);
      assert.equal(t.wanderrange, 0); assert.equal(t.moverestrict, 5); assert.equal(t.defaultmode, 0);
      assert(!t.params?.has(id('ParamType', 'fishing_movement_enum')));
      for (const option of [1, 3, 4, 5]) assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.OPNPC1 + option - 1, type, t.category)?.name, `[opnpc${option},${spot.name}]`);
      const natural = [...World.npcs].filter(n => n.baseType === type);
      assert.equal(natural.length, spot.placements);
      const fishable = natural.flatMap(n => [[n.x - 1, n.z], [n.x + 1, n.z], [n.x, n.z - 1], [n.x, n.z + 1]]
        .filter(([x, z]) => !map.isMapBlocked(x, z, n.level)).map(bank => ({ water: [n.level, n.x, n.z], bank })));
      assert(fishable.length, 'at least one original spot has a walkable bank');
      console.log(`BANKS ${spot.name} ${JSON.stringify(fishable)}`);
    });
    for (const method of methods[spot.category]) {
      test(`${spot.name} op${method.option}: level boundary refusal`, () => refusal(spot, method, method.level - 1, [method.tool], method.message));
      test(`${spot.name} op${method.option}: missing tool refusal`, () => refusal(spot, method, 99, [], equipmentMessage(method.tool)));
      for (const level of new Set([method.level, method.secondary ? method.secondary - 1 : 99, method.secondary ?? 99])) {
        test(`${spot.name} op${method.option}: exact published behavioral control at ${level}`, () => {
          const f = fixture(type, level, [method.tool]), control = fixture(reference(spot.category), level, [method.tool]);
          try { assert.deepEqual(run(f, method), run(control, method)); }
          finally { dispose(f); dispose(control); }
        });
      }
      if (method.bigNet) {
        for (const [level, cod, bass, experience] of [[16, 0, 0, 621], [22, 0, 0, 621], [23, 1, 0, 1071], [45, 1, 0, 1071], [46, 1, 1, 2071]]) {
          test(`${spot.name}: complete big-net table at ${level}`, () => {
            const f = fixture(type, level, [method.tool]), beforeXp = xp(f.p);
            try {
              run(f, method, 4);
              for (const [name, qty] of [['leather_boots', 1], ['seaweed', 1], ['leather_gloves', 1], ['raw_mackerel', 2], ['oystershell', 1], ['casket', 1], ['raw_cod', cod], ['raw_bass', bass]]) assert.equal(count(f.p, name), qty, name);
              assert.equal(xp(f.p) - beforeXp, experience);
            } finally { dispose(f); }
          });
        }
      } else {
        for (const [index, [fish, experience]] of method.products.entries()) {
          test(`${spot.name} op${method.option}: ${fish} catch, exact XP and continuation`, () => {
            const f = fixture(type, 99, [method.tool]), beforeXp = xp(f.p);
            try {
              run(f, method, 5, method.products.length === 2 && index === 0 ? 'fallback' : 'success');
              assert.equal(count(f.p, fish), 1); assert.equal(xp(f.p) - beforeXp, experience);
              for (const [other] of method.products) if (other !== fish) assert.equal(count(f.p, other), 0);
              assert.equal(f.p.target, f.n); assert.equal(f.p.targetOp, ServerTriggerType.APNPC1 + (method.option === 1 ? 3 : 4));
            } finally { dispose(f); }
          });
        }
      }
      test(`${spot.name} op${method.option}: failed catch consumes and awards nothing`, () => {
        const f = fixture(type, 99, [method.tool]), before = inventory(f.p), beforeXp = xp(f.p);
        try { run(f, method, 18, 'failure'); assert.deepEqual(inventory(f.p), before); assert.equal(xp(f.p), beforeXp); }
        finally { dispose(f); }
      });
    }
  }
} finally { Runner.HANDLERS[ScriptOpcode.STAT_RANDOM] = nativeStatRandom; }
console.log(`N617 ${cases - failures}/${cases} cases passed`);
process.exitCode = failures ? 1 : 0;
