import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// Reuse the existing transport-free packed-world loader, including the genuine 377 map.
import { Player, ScriptProvider, ScriptRunner, ScriptState, World, engine, map, pack, locFor, nativeLocRows, packed, requiredId, types } from '../regicide-travel/runtime.mjs';
const { ScriptOpcode: op } = await import(pathToFileURL(`${engine}/src/engine/script/ScriptOpcode.ts`).href);
const { default: ClientCheatHandler } = await import(pathToFileURL(`${engine}/src/network/game/client/handler/ClientCheatHandler.ts`).href);
const { default: ClientCheat } = await import(pathToFileURL(`${engine}/src/network/game/client/model/ClientCheat.ts`).href);
const { default: DbTableIndex } = await import(pathToFileURL(`${engine}/src/cache/config/DbTableIndex.ts`).href);
const { default: MessageGameEncoder } = await import(pathToFileURL(`${engine}/src/network/game/server/codec/MessageGameEncoder.ts`).href);
const { default: JavaRandom } = await import(pathToFileURL(`${engine}/src/util/JavaRandom.ts`).href);
const invId = requiredId(types.InvType, 'inv');
const eventVar = requiredId(types.VarPlayerType, 'macro_event');
const handlers = { ...ScriptRunner.HANDLERS };
function identities() {
  const genie = types.NpcType.get(requiredId(types.NpcType, 'macro_geni'));
  return { genie: { id: genie.id, models: [...genie.models], ops: genie.op }, bronzePickaxe: requiredId(types.ObjType, 'bronze_pickaxe'), pickaxeHandle: requiredId(types.ObjType, 'macro_pickaxehandle'), bronzeHead: requiredId(types.ObjType, 'macro_bronze_pickaxehead'), rock: requiredId(types.LocType, 'copperrock1'), lumbridgeButton: requiredId(types.Component, 'magic:lumbridge_teleport'), appendages: [1, 2, 3, 4].map(i => requiredId(types.LocType, `macro_laf_appendage_${i}`)) };
}
const names = ['swarm', 'genie', 'drunken-dwarf', 'mysterious-old-man', 'candlelight', 'strange-plant', 'lost-pickaxe', 'smoking-rock', 'rock-golem', 'tree-spirit', 'ent', 'lost-axe', 'big-fish', 'river-troll', 'whirlpool', 'zombie', 'shade', 'watchman', 'poisonous-gas', 'lost-and-found'];
const spawners = ['macro_event_general_spawn', 'macro_event_lost_pickaxe_spawn', 'macro_event_gas_spawn', 'macro_event_rock_golem_spawn', 'macro_event_dryad_spawn', 'macro_event_ent_spawn', 'macro_event_lost_axe_spawn', 'macro_event_bigfish_spawn', 'macro_event_river_troll_spawn', 'macro_event_whirlpool_spawn', 'macro_event_zombie_spawn', 'macro_event_shade_spawn', 'macro_event_watchman_spawn', 'macro_event_macro_gas_chest', 'macro_laf_start'];
let serial = 0;
let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
const baseline = JSON.parse(readFileSync(new URL('./inert-baseline.json', import.meta.url), 'utf8'));
check('published packed actor model option tool loc and component identities are unchanged', () => assert.deepEqual(identities(), baseline.identities));
function player(tile = [0, 3222, 3218]) {
  const slot = ++serial;
  const p = new Player(`u00_${slot}`, BigInt(slot), 0n);
  p.slot = slot; p.pid = slot;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | slot) >>> 0;
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99);
  [p.level, p.x, p.z] = tile;
  p.buildArea.originX = Math.floor(p.x / 8) * 8;
  p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  p.messages = [];
  p.write = packet => p.messages.push(packet);
  World.players[slot] = p;
  return p;
}
function give(p, name) { p.invAdd(invId, requiredId(types.ObjType, name), 1); }
function nextTo(row) { return [row.level, row.x - 1, row.z]; }
function targetLoc(name, kind = name === 'tree' ? 1 : name === 'chest_10_coins' ? 2 : 0) {
  const rows = nativeLocRows(name);
  for (const row of rows) {
    const loc = locFor(row);
    for (const tile of [[row.level, row.x - 1, row.z], [row.level, row.x + loc.width, row.z], [row.level, row.x, row.z - 1], [row.level, row.x, row.z + loc.length]]) {
      const p = player(tile);
      const state = ScriptRunner.init(packed('[proc,macro_fixture_loc]'), p, null, [kind, kind === 1 ? 10 : kind === 2 ? 19 : 8]);
      give(p, 'bronze_pickaxe'); give(p, 'bronze_axe');
      ScriptRunner.execute(state);
      if (state.execution === ScriptState.FINISHED && state.intStack[state.isp - 1] === loc.type) return { row, loc, tile };
      World.players[p.slot] = null;
    }
  }
  assert.fail(`no accessible genuine ${name} target`);
}
const rock = targetLoc('copperrock1');
const tree = targetLoc('tree');
const chest = targetLoc('chest_10_coins');
const saltCategory = requiredId(types.CategoryType, 'saltfish');
const fish = [...World.npcs].find(n => types.NpcType.get(n.type).category === saltCategory && !map.isMapBlocked(n.x - 1, n.z, n.level) && map.reachedEntity(n.level, n.x - 1, n.z, n.x, n.z, n.width, n.length, 1));
assert(fish, 'a genuine saltfish placement is packed');
const man = [...World.npcs].find(n => n.type === requiredId(types.NpcType, 'man'));
assert(man, 'a genuine pickpocketable Man is packed');
function prep(index) {
  if (index >= 7 && index <= 9) { const p = player(rock.tile); give(p, 'bronze_pickaxe'); return p; }
  if (index >= 10 && index <= 12) { const p = player(tree.tile); give(p, 'bronze_axe'); return p; }
  if (index >= 13 && index <= 15) { const p = player([fish.level, fish.x - 1, fish.z]); give(p, 'net'); return p; }
  if (index === 18) return player([man.level, man.x - 1, man.z]);
  if (index === 19) return player(chest.tile);
  const p = player();
  if (index === 16 || index === 17) give(p, 'bones');
  return p;
}
function snap(p) {
  return { vars: [...p.vars], inventory: p.getInventory(invId).items.map(i => i ? { id: i.id, count: i.count } : null), npcs: [...World.npcs].map(n => [n.uid, n.type, n.x, n.z]), modalChat: p.modalChat, modalMain: p.modalMain, tile: [p.level, p.x, p.z] };
}
function run(p, name, { stop = true, removeAdmission = false, unknownFallthrough = false, raw = false } = {}) {
  const calls = [];
  let unknownChanged = false;
  let observedState;
  for (const [code, original] of Object.entries(handlers)) {
    ScriptRunner.HANDLERS[code] = state => {
      observedState = state;
      if (state.pc === 0) {
        calls.push({ name: state.script.name, ints: state.intLocals.slice(0, state.script.intArgCount), strings: state.stringLocals.slice(0, state.script.stringArgCount), loc: state._activeLoc ? { type: state._activeLoc.type, x: state._activeLoc.x, z: state._activeLoc.z, level: state._activeLoc.level } : null, npc: state._activeNpc?.type });
        if (stop && spawners.some(s => state.script.name === `[proc,${s}]`)) { state.execution = ScriptState.FINISHED; return; }
      }
      // Scratch interpreter mutants: bypass only the caller's admission call, or force
      // the first unknown-name comparison to equal. The packed predicate below must reject both.
      if (removeAdmission && Number(code) === op.GOSUB_WITH_PARAMS && state.script.name === '[label,macro_fixture_enter]' && ScriptProvider.get(state.intOperand)?.name === '[proc,macro_event_allowed]') { state.pushInt(1); return; }
      if (unknownFallthrough && !unknownChanged && Number(code) === op.COMPARE && state.script.name === '[debugproc,macro_event]') { state.popString(); state.popString(); state.pushInt(0); unknownChanged = true; return; }
      original(state);
    };
  }
  try {
    let state;
    if (raw) {
      p.staffModLevel = 4;
      assert(new ClientCheatHandler().handle(new ClientCheat(name), p), 'real cheat handler accepts the raw packet');
      state = observedState;
      assert(state, 'the real parser executes a packed script');
    } else {
      state = ScriptRunner.init(packed('[debugproc,macro_event]'), p, null, [name]);
      ScriptRunner.execute(state);
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, `${name} aborts`);
    for (const message of p.messages.filter(m => m.msg?.startsWith('[staff fixture]'))) assert(new MessageGameEncoder().test(message) <= 255, `fixture diagnostic exceeds MESSAGE_GAME framing: ${message.msg}`);
    return { state, calls, entries: calls.filter(c => spawners.some(s => c.name === `[proc,${s}]`)) };
  } finally {
    Object.assign(ScriptRunner.HANDLERS, handlers);
  }
}
// These traces are captured from the published pack, never from copied RuneScript.
// The opt-in baseline run also executes the old pack in this same real interpreter.
function inertTrace(name) {
  const row = name.includes('oploc') ? nativeLocRows('copperrock1').find(row => World.getLoc(row.x, row.z, row.level, requiredId(types.LocType, 'copperrock1'))) : null;
  if (name.includes('oploc')) assert(row, 'a fresh genuine copper rock is required for each ordinary mining run');
  const p = player(row ? nextTo(row) : undefined);
  if (name.includes('oploc')) {
    give(p, 'bronze_pickaxe');
    p.setVar(requiredId(types.VarPlayerType, 'action_delay'), World.currentTick);
  }
  if (name.includes('if_button')) for (const [name, quantity] of [['lawrune', 1], ['airrune', 3], ['earthrune', 1]]) p.invAdd(invId, requiredId(types.ObjType, name), quantity);
  const trace = [];
  const random = Math.random;
  Math.random = () => 0.5;
  for (const [code, original] of Object.entries(handlers)) ScriptRunner.HANDLERS[code] = state => {
    // Numeric packed operands contain relocated script/config ids. Compare executed
    // command identities/positions and string literals, not unrelated pack numbering.
    trace.push([state.script.name, state.pc, Number(code), state.stringOperand]);
    assert(!state.script.name.includes('macro_fixture'), 'ordinary action must never enter the fixture');
    original(state);
  };
  try {
    const state = ScriptRunner.init(packed(name), p, row ? locFor(row) : null, []);
    // RANDOM, RANDOMINC and STAT_RANDOM use this singleton, not Math.random.
    // Reset each root so earlier draws and process state cannot select its trace.
    JavaRandom.setSeed(0);
    p.runScript(state, true);
    for (let resumes = 0; state.execution === ScriptState.SUSPENDED && resumes < 10; resumes++) {
      state.execution = ScriptState.RUNNING;
      p.runScript(state, true, true);
    }
    assert.equal(state.execution, ScriptState.FINISHED, `ordinary ${name} completes`);
    assert.equal(p.getVar(eventVar), 0);
    assert(!trace.some(([name]) => spawners.some(s => name === `[proc,${s}]`)), 'ordinary action must not spawn an event');
    return { commands: trace.length, sha256: createHash('sha256').update(JSON.stringify(trace)).digest('hex') };
  } finally {
    Math.random = random;
    Object.assign(ScriptRunner.HANDLERS, handlers);
  }
}
function loadPack(directory) {
  for (const Type of Object.values(types)) Type.load(directory);
  DbTableIndex.init();
  assert(ScriptProvider.load(directory) > 0);
}
check('packed command has only one string argument; obsolete aliases are absent', () => {
  const script = packed('[debugproc,macro_event]');
  assert.equal(script.intArgCount, 0); assert.equal(script.stringArgCount, 1);
  assert.equal(ScriptProvider.getByName('[debugproc,random_event]'), undefined);
  assert.equal(ScriptProvider.getByName('[debugproc,random]'), undefined);
});
check('every packed fixture diagnostic literal fits the real MESSAGE_GAME frame', () => {
  for (const name of ['[debugproc,macro_event]', '[label,macro_fixture_enter]']) {
    for (const literal of packed(name).stringOperands.filter(s => s?.includes('[staff fixture]'))) assert(Buffer.byteLength(literal) + 1 <= 255, literal);
  }
});
for (let index = 1; index <= names.length; index++) check(`packed accepted name ${names[index - 1]} reaches its production boundary`, () => {
  const p = prep(index);
  const result = run(p, names[index - 1]);
  assert.equal(result.entries.length, 1, JSON.stringify(p.messages));
  const call = result.entries[0];
  const expected = index <= 6 ? spawners[0] : spawners[index - 6];
  assert.equal(call.name, `[proc,${expected}]`);
  assert.deepEqual(call.ints, index <= 6 ? [index] : index === 13 ? [requiredId(types.ObjType, 'net')] : index === 20 ? [(3213 << 14) | 3424] : []);
  if ([8, 11, 19].includes(index)) {
    assert(call.loc && World.getLoc(call.loc.x, call.loc.z, call.loc.level, call.loc.type), 'bound target is a genuine map loc');
    assert(p.inOperableDistance(World.getLoc(call.loc.x, call.loc.z, call.loc.level, call.loc.type)), 'bound target is within the engine operate reach');
    if (index === 8) assert.equal(call.loc.type, rock.loc.type);
    if (index === 19) assert.equal(call.loc.type, chest.loc.type);
  }
  if ([13, 15].includes(index)) assert.equal(call.npc, fish.type);
  assert.equal(p.getVar(eventVar), 0, 'caller itself seeds no active event');
});
check('blocked Varrock tile is conservatively refused although engine operate reach accepts', () => {
  const row = nativeLocRows('copperrock1').find(r => r.level === 0 && r.x === 3282 && r.z === 3368);
  assert(row);
  const p = player(nextTo(row));
  assert(p.inOperableDistance(locFor(row)));
  give(p, 'bronze_pickaxe');
  refusal(p, 'lost-pickaxe');
});
function refusal(p, name, options = {}) {
  const before = snap(p);
  const result = run(p, name, options);
  assert.equal(result.entries.length, 0, 'refused entry must not reach a spawner');
  assert.deepEqual(snap(p), before, 'refusal changes no variable, inventory, NPC, modal or position');
  assert(p.messages.some(m => String(m.msg ?? '').includes('[staff fixture]')), 'staff fixture diagnostic is present');
}
for (const name of ['not-built', '2', 'genie somebody', 'maze', '', player().username, '1234567', '0_50_53_13_32']) check(`unknown/refused ${JSON.stringify(name)}`, () => refusal(player(), name));
for (let index = 7; index <= 19; index++) check(`missing prerequisite ${names[index - 1]}`, () => refusal(player([0, 2000, 2000]), names[index - 1]));
// Genuine targets remain present in every prerequisite regression. Each has a
// same-target positive control, so dropping a prerequisite cannot hide behind reach.
for (const [name, index, skill] of [['lost-pickaxe', 7, 'mining'], ['tree-spirit', 10, 'woodcutting'], ['big-fish', 13, null], ['poisonous-gas', 19, 'thieving'], ['watchman', 18, 'thieving']]) {
  if (index <= 13) check(`real target without tool refuses ${name} without mutation`, () => {
    const p = prep(index);
    p.getInventory(invId).items.fill(null);
    refusal(p, name);
    assert(p.messages.some(m => m.msg === '[staff fixture] Refused: missing prerequisite or tile not proved adjacent.'));
    give(p, index === 7 ? 'bronze_pickaxe' : index === 10 ? 'bronze_axe' : 'net');
    assert.equal(run(p, name).entries.length, 1, 'same-target tool positive control');
  });
  if (skill) check(`real target below level refuses ${name} without mutation`, () => {
    const p = skill === 'woodcutting' ? player(targetLoc('oaktree', 1).tile) : prep(index);
    if (skill === 'woodcutting') give(p, 'bronze_axe');
    const stat = { mining: 14, woodcutting: 8, thieving: 17 }[skill];
    p.levels[stat] = 0;
    refusal(p, name);
    assert(p.messages.some(m => m.msg === '[staff fixture] Refused: missing prerequisite or tile not proved adjacent.'));
    p.levels[stat] = 99;
    assert.equal(run(p, name).entries.length, 1, 'same-target level positive control');
  });
}
function locSelection(tile, kind, event, tool) {
  const p = player(tile);
  give(p, tool);
  const before = snap(p);
  const state = ScriptRunner.init(packed('[proc,macro_fixture_loc]'), p, null, [kind, event]);
  ScriptRunner.execute(state);
  assert.equal(state.execution, ScriptState.FINISHED);
  assert.deepEqual(snap(p), before, 'target selection itself is inert');
  const type = state.intStack[state.isp - 1];
  const coord = state.intStack[state.isp - 2] >>> 0;
  return type === -1 ? null : World.getLoc((coord >>> 14) & 0x3fff, coord & 0x3fff, coord >>> 28, type);
}
for (const tile of [[0, 1992, 4663], [0, 1992, 4665], [0, 1994, 4663], [0, 1994, 4665], [0, 2688, 3335]]) check(`diagonal or fenced genuine rock refuses ${tile}`, () => {
  assert.equal(locSelection(tile, 0, 7, 'bronze_pickaxe'), null);
});
for (const tile of [[0, 2890, 4849]]) check(`five-tile essence rock edge admits ${tile}`, () => {
  const loc = locSelection(tile, 0, 7, 'bronze_pickaxe');
  assert(loc);
  assert.equal(loc.type, requiredId(types.LocType, 'blankrunestone'));
  assert(map.reachedLoc(tile[0], tile[1], tile[2], loc.x, loc.z, loc.width, loc.length, 1, loc.angle, loc.shape, types.LocType.get(loc.type).forceapproach));
});
for (const tile of [[0, 1876, 4507], [0, 1874, 4509]]) check(`large genuine tree east or north edge admits ${tile}`, () => {
  const loc = locSelection(tile, 1, 10, 'bronze_axe');
  assert(loc);
  assert(map.reachedLoc(tile[0], tile[1], tile[2], loc.x, loc.z, loc.width, loc.length, 1, loc.angle, loc.shape, types.LocType.get(loc.type).forceapproach));
});
check('unallocated neighbor map tree tile is refused with the engine', () => {
  const row = nativeLocRows('deadtree1').find(r => r.level === 0 && r.x === 2304 && r.z === 3459);
  const p = player([0, 2303, 3459]);
  assert.equal(p.inOperableDistance(locFor(row)), false);
  assert.equal(locSelection([0, 2303, 3459], 1, 10, 'bronze_axe'), null);
});
check('blocked essence east tile is conservatively refused although engine accepts', () => {
  const row = nativeLocRows('blankrunestone').find(r => r.level === 0 && r.x === 2891 && r.z === 4847);
  const p = player([0, 2896, 4849]);
  assert(p.inOperableDistance(locFor(row)));
  assert.equal(locSelection([0, 2896, 4849], 0, 7, 'bronze_pickaxe'), null);
});
check('blocked fishing west tile is conservatively refused although engine accepts', () => {
  const target = [...World.npcs].find(n => n.x === 3267 && n.z === 3148 && n.level === 0 && types.NpcType.get(n.type).category === saltCategory);
  assert(target);
  const p = player([0, 3266, 3148]);
  assert(p.inOperableDistance(target));
  give(p, 'net');
  refusal(p, 'big-fish');
});
for (const name of ['lost-pickaxe', 'rock-golem', 'smoking-rock']) check(`smoking rock is excluded by the real mining selector ${name}`, () => {
  const row = rock.row;
  const loc = locFor(row);
  const original = { type: loc.type, shape: loc.shape, angle: loc.angle };
  loc.change(requiredId(types.LocType, 'macro_clayrock1'), loc.shape, loc.angle);
  try {
    const p = player(rock.tile);
    give(p, 'bronze_pickaxe');
    refusal(p, name);
    assert(p.messages.some(m => m.msg === '[staff fixture] Refused: missing prerequisite or tile not proved adjacent.'));
  } finally { loc.change(original.type, original.shape, original.angle); }
  const p = player(rock.tile);
  give(p, 'bronze_pickaxe');
  assert.equal(run(p, name).entries.length, 1, 'healthy same-target positive control');
});
for (const name of ['genie', 'lost-pickaxe', 'lost-and-found']) {
  check(`unsafe area ${name} refuses without mutation`, () => refusal(player([0, 3100, 3100]), name));
  check(`active event ${name} refuses without mutation`, () => { const p = prep(name === 'lost-pickaxe' ? 7 : 2); p.setVar(eventVar, 2); refusal(p, name); });
}
check('unknown diagnostic derives every accepted name from the packed name table', () => {
  const p = player(); run(p, 'not-built');
  const message = p.messages.map(m => m.msg ?? '').join('\n');
  for (const name of names) assert(message.includes(name), name);
});
check('real parser ignores suffix but spawns exactly one Genie for the caller only', () => {
  const p = player();
  const other = player();
  const beforeOther = snap(other);
  const before = new Set([...World.npcs].map(n => n.uid));
  run(p, `~macro_event genie ${other.uid}`, { stop: false, raw: true });
  const added = [...World.npcs].filter(n => !before.has(n.uid));
  assert.equal(added.length, 1);
  assert.equal(added[0].type, requiredId(types.NpcType, 'macro_geni'));
  assert.equal(added[0].getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')) >>> 0, p.uid);
  assert.equal(p.getVar(eventVar), 2);
  const afterOther = snap(other);
  assert.deepEqual(afterOther.vars, beforeOther.vars);
  assert.deepEqual(afterOther.inventory, beforeOther.inventory);
  assert.equal(other.getVar(eventVar), 0);
});
check('admission-removal mutant is caught by the same refusal predicate', () => {
  const p = prep(7); p.setVar(eventVar, 2);
  assert.throws(() => refusal(p, 'lost-pickaxe', { removeAdmission: true }), /must not reach a spawner/);
});
check('unknown-fallthrough mutant is caught by the same refusal predicate', () => {
  assert.throws(() => refusal(player(), 'not-built', { unknownFallthrough: true }), /must not reach a spawner/);
});
const ordinaryRoots = ['[login,_]', '[queue,macro_event_login]', '[oploc1,_mining_rock_normal]', '[if_button,magic:lumbridge_teleport]'];
if (process.env.U00_BASELINE_PACK) {
  loadPack(process.env.U00_BASELINE_PACK);
  try {
    console.log(`PUBLISHED_IDENTITIES ${JSON.stringify(identities())}`);
    for (const root of ordinaryRoots) console.log(`PUBLISHED_TRACE ${JSON.stringify([root, inertTrace(root)])}`);
  } finally { loadPack(pack); }
}
for (const root of ordinaryRoots) check(`ordinary packed commands match published trace ${root}`, () => {
  assert.deepEqual(inertTrace(root), baseline.traces[root]);
});
console.log(`RESULT ${failed ? 'FAIL' : 'PASS'} random-events-u00 passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
