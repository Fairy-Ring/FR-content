import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Npc, EntityLifeCycle, Player, ResumePauseButtonHandler, ResumePauseButton, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType, World, engine, pack, packed, requiredId, types } from '../regicide-travel/runtime.mjs';

const { default: DbTableIndex } = await import(pathToFileURL(`${engine}/src/cache/config/DbTableIndex.ts`).href);
const { ScriptOpcode: op } = await import(pathToFileURL(`${engine}/src/engine/script/ScriptOpcode.ts`).href);
const { default: IfButtonHandler } = await import(pathToFileURL(`${engine}/src/network/game/client/handler/IfButtonHandler.ts`).href);
const { default: IfButton } = await import(pathToFileURL(`${engine}/src/network/game/client/model/IfButton.ts`).href);
const { PlayerStat } = await import(pathToFileURL(`${engine}/src/engine/entity/PlayerStat.ts`).href);
const { default: JavaRandom } = await import(pathToFileURL(`${engine}/src/util/JavaRandom.ts`).href);
const { default: Environment } = await import(pathToFileURL(`${engine}/src/util/Environment.ts`).href);
const inv = requiredId(types.InvType, 'inv');
const bank = requiredId(types.InvType, 'bank');
const v = name => requiredId(types.VarPlayerType, name);
const coord = (level, x, z) => (level << 28) | (x << 14) | z;
const O = [0, 3222, 3218];
const D = coord(0, 3213, 3424);
const laf = 7;
let serial = 0;
let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
function player(tile = O) {
  const slot = ++serial;
  const p = new Player(`u01_${slot}`, BigInt(slot), 0n);
  p.slot = slot; p.pid = slot;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | slot) >>> 0;
  p.baseLevels.fill(99); p.levels.fill(99);
  [p.level, p.x, p.z] = tile;
  p.buildArea.originX = Math.floor(p.x / 8) * 8;
  p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  p.messages = [];
  p.write = packet => p.messages.push(packet);
  p.defaults = [...p.vars];
  World.players[slot] = p;
  return p;
}
function run(p, root, args = [], { npc = null, protect = true, resume = true } = {}) {
  const state = ScriptRunner.init(packed(root), p, npc, args);
  p.runScript(state, protect);
  for (let i = 0; resume && state.execution === ScriptState.SUSPENDED && i < 20; i++) {
    p.delayed = false;
    state.execution = ScriptState.RUNNING;
    p.runScript(state, true, true);
  }
  assert.notEqual(state.execution, ScriptState.ABORTED, `${root} must not abort in the real VM`);
  assert.notEqual(state.execution, ScriptState.SUSPENDED, `${root} must finish its bounded delays`);
  return state;
}
function json(value) { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)); }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function actors() { return [...World.npcs].filter(n => n.isActive).map(n => [n.uid, types.NpcType.get(n.type).debugname, n.level, n.x, n.z]).sort((a, b) => a[0] - b[0]); }
function actorInventory() {
  const list = actors();
  return { count: list.length, sha256: digest(list) };
}
function snapshot(p) {
  const vars = {};
  for (let id = 0; id < p.vars.length; id++) if (p.vars[id] !== p.defaults[id]) vars[types.VarPlayerType.get(id).debugname] = p.vars[id];
  return {
    tile: [p.level, p.x, p.z], vars,
    inventory: p.getInventory(inv).items.map(i => i ? [types.ObjType.get(i.id).debugname, i.count] : null),
    messages: json(p.messages), tabs: [...p.tabs], modals: [p.modalMain, p.modalChat, p.modalSide],
    queues: ['queue', 'weakQueue', 'engineQueue'].map(key => [...p[key].all()].map(q => [q.script.name, q.type, q.delay, q.args])),
    actors: actorInventory()
  };
}
function give(p, name, quantity = 1) { p.invAdd(inv, requiredId(types.ObjType, name), quantity); }
function reload(directory) {
  for (const Type of Object.values(types)) Type.load(directory);
  DbTableIndex.init();
  assert(ScriptProvider.load(directory) > 0);
}
// U01's no-event contract: ordinary login, death and teleport still work, while
// event hooks cannot start an encounter or disturb a player with no active event.
// Compare inert hooks with their own pre-state, not an unrelated login recording.
const roots = ['[login,_]', '[queue,macro_event_login]', '[timer,general_macro_events]', '[proc,p_telejump_safe]', '[queue,player_death_default]', '[if_button,magic:lumbridge_teleport]'];
const eventVars = ['macro_event', 'macro_event_uid', 'macro_event_origin_coord', 'macro_event_target_coord', 'macro_transmit'];
const contents = inventory => inventory.filter(Boolean).sort(([a], [b]) => a.localeCompare(b));
function normalTabs(p) {
  for (const [tab, name] of [[3, 'inventory'], [4, 'wornitems'], [6, 'magic'], [10, 'logout']]) {
    assert.equal(p.tabs[tab], requiredId(types.Component, name), `ordinary ${name} tab remains available`);
  }
}
function noEventEffects(root) {
  const p = player();
  if (root.includes('death')) for (const item of ['bronze_pickaxe', 'airrune', 'lawrune']) give(p, item);
  if (root.includes('if_button')) for (const [item, quantity] of [['lawrune', 1], ['airrune', 3], ['earthrune', 1]]) give(p, item, quantity);
  const before = snapshot(p);
  const beforeEvent = eventVars.map(name => p.getVar(v(name)));
  const random = Math.random, nextDouble = JavaRandom.nextDouble, enabled = Environment.NODE_RANDOM_EVENTS;
  Math.random = () => 0.5;
  JavaRandom.nextDouble = () => 0.2;
  Environment.NODE_RANDOM_EVENTS = false;
  p.afkEventReady = true; // A ready roll must still be inert with the engine flag off.
  const dateMinutes = ScriptRunner.HANDLERS[op.DATE_MINUTES];
  ScriptRunner.HANDLERS[op.DATE_MINUTES] = state => state.pushInt(30000000); // Labelled deterministic fixture clock.
  try {
    run(p, root, root.includes('p_telejump_safe') ? [D] : []);
    const after = snapshot(p);
    assert.deepEqual(after.actors, before.actors, `${root} must not change actor inventory`);
    assert.deepEqual(eventVars.map(name => p.getVar(v(name))), beforeEvent, `${root} must not write encounter state`);
    const eventQueues = after.queues.flat().filter(([name]) => name.includes('macro_event'));
    assert.deepEqual(eventQueues, root === '[login,_]' ? [['[queue,macro_event_login]', 0, 0, [0]]] : [],
      `${root} cannot schedule a new event or a later event effect`);
    if (root === '[queue,macro_event_login]' || root === '[timer,general_macro_events]') {
      assert.deepEqual(after, before, `${root} is completely inert without an active event`);
    } else if (root === '[login,_]') {
      assert.deepEqual(after.tile, before.tile, 'ordinary login does not move the player');
      assert.deepEqual(after.inventory, before.inventory, 'ordinary login does not give or take items');
      assert(p.messages.some(packet => packet.msg === 'Welcome to RuneScape.'));
      normalTabs(p);
    } else if (root === '[proc,p_telejump_safe]') {
      assert.deepEqual(after.tile, [0, 3213, 3424], 'ordinary safe teleport reaches its exact destination');
      for (const key of ['vars', 'inventory', 'tabs', 'modals']) assert.deepEqual(after[key], before[key], `safe teleport preserves ${key}`);
      assert.deepEqual(p.messages.filter(packet => packet.msg), [], 'safe teleport emits no event message');
    } else {
      assert.equal(p.level, 0);
      assert(Math.abs(p.x - 3221) <= 2 && Math.abs(p.z - 3218) <= 2, 'ordinary Lumbridge arrival is within its two-tile radius');
      if (root.includes('death')) {
        assert.deepEqual(contents(after.inventory), contents(before.inventory), 'ordinary death retains the three protected fixture items');
        assert(p.messages.some(packet => packet.msg === 'Oh dear you are dead!'));
        normalTabs(p);
      } else {
        assert.deepEqual(contents(after.inventory), [], 'ordinary Lumbridge spell consumes its runes and gives no event reward');
        assert.deepEqual(after.tabs, before.tabs, 'ordinary spell does not hide tabs');
        assert.deepEqual(after.modals, before.modals, 'ordinary spell leaves no event modal');
        assert.deepEqual(p.messages.filter(packet => packet.msg), [], 'ordinary spell emits no event message');
      }
    }
    return after;
  } finally {
    Math.random = random;
    JavaRandom.nextDouble = nextDouble;
    Environment.NODE_RANDOM_EVENTS = enabled;
    ScriptRunner.HANDLERS[op.DATE_MINUTES] = dateMinutes;
  }
}
const noEventResults = new Map();
for (const root of roots) check(`event-off ordinary behavior ${root}`, () => noEventResults.set(root, noEventEffects(root)));
check('event-off login keeps Farming growth and restores a saved stall lockout', () => {
  const p = player();
  const actorShapes = () => actors().map(([, name, level, x, z]) => [name, level, x, z])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const beforeActors = actorShapes();
  const stallVar = v('thieving_stall_timer');
  const stallMask = 1 << 1; // Published baker stall bit.
  p.setVar(stallVar, stallMask);
  const random = Math.random;
  Math.random = () => 0.5;
  const dateMinutes = ScriptRunner.HANDLERS[op.DATE_MINUTES];
  ScriptRunner.HANDLERS[op.DATE_MINUTES] = state => state.pushInt(30000000);
  try { run(p, '[login,_]'); }
  finally {
    Math.random = random;
    ScriptRunner.HANDLERS[op.DATE_MINUTES] = dateMinutes;
  }
  assert.equal(p.getVar(v('farming_growth_minute')), 30000000);
  const growth = ScriptProvider.getByName('[softtimer,farming_growth]');
  assert(growth, 'compiled Farming growth soft timer');
  const growthTimer = p.timers.get(growth.id);
  assert(growthTimer && growthTimer.interval > 0, 'login installs the Farming growth timer');
  const stalls = [...p.queue.all()].filter(q => q.script.name.startsWith('[queue,stolen_from_stall_'));
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].script.name, '[queue,stolen_from_stall_baker]');
  assert.equal(stalls[0].delay, 1500);
  assert.deepEqual(stalls[0].args, [0, 1]);
  assert.equal(p.getVar(stallVar), stallMask);
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.deepEqual(actorShapes(), beforeActors, 'event-off login creates no actor');
  run(p, '[queue,macro_event_login]');
  assert.equal(p.getVar(v('macro_event')), 0, 'event-off login queue remains inert');
  assert.deepEqual(actorShapes(), beforeActors, 'event-off login queue creates no actor');
});
if (process.env.U01_PUBLISHED_PACK) {
  reload(process.env.U01_PUBLISHED_PACK);
  try {
    for (const root of roots) check(`published-pack event-off ordinary behavior ${root}`, () => noEventEffects(root));
  } finally { reload(pack); }
}
check('negative control: a changed no-event teleport tile fails the behavior predicate', () => {
  const original = ScriptRunner.HANDLERS[op.P_TELEJUMP];
  let changedTile;
  ScriptRunner.HANDLERS[op.P_TELEJUMP] = state => {
    original(state);
    state.activePlayer.x++;
    changedTile = [state.activePlayer.level, state.activePlayer.x, state.activePlayer.z];
  };
  try {
    assert.throws(() => noEventEffects('[proc,p_telejump_safe]'), /ordinary safe teleport reaches its exact destination/);
    assert.deepEqual(changedTile, [0, 3214, 3424], 'the control changes the actual destination');
  } finally { ScriptRunner.HANDLERS[op.P_TELEJUMP] = original; }
});
check('static packed identities and client configs match the published pack', () => {
  const genie = types.NpcType.get(requiredId(types.NpcType, 'macro_geni'));
  assert.equal(genie.id, 409);
  assert.deepEqual([...genie.models], [231, 241, 252, 315, 173, 176, 264, 270]);
  assert.deepEqual(genie.op, ['Talk-to', null, null, null, null]);
  assert.deepEqual([1, 2, 3, 4].map(i => requiredId(types.LocType, `macro_laf_appendage_${i}`)), [8994, 8995, 8996, 8997]);
  const origin = types.VarPlayerType.get(v('macro_event_origin_coord'));
  assert.equal(origin.id, 59, 'reuse an original unused client slot rather than append a varp');
  assert.equal(origin.scope, types.VarPlayerType.SCOPE_PERM);
  assert.equal(origin.transmit, false);
  for (const name of ['macro_event', 'macro_event_target_coord']) assert.equal(types.VarPlayerType.get(v(name)).scope, types.VarPlayerType.SCOPE_PERM);
  const clientConfigs = JSON.parse(readFileSync(new URL('./client-configs.json', import.meta.url), 'utf8'));
  for (const [file, expected] of Object.entries(clientConfigs)) assert.equal(createHash('sha256').update(readFileSync(`${pack}/client/${file}`)).digest('hex'), expected, file);
});
function genie(p) {
  run(p, '[proc,macro_event_general_spawn]', [2], { protect: false });
  assert.equal(p.getVar(v('macro_event')), 2);
  const npc = World.getNpcByUid(p.getVar(v('macro_event_uid')));
  assert(npc, 'real packed Genie was allocated');
  assert.equal(npc.type, requiredId(types.NpcType, 'macro_geni'));
  assert.equal(npc.getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')), p.uid | 0);
  return npc;
}
function cleanup(p, event = p.getVar(v('macro_event')), actor = p.getVar(v('macro_event_uid'))) { run(p, '[proc,macro_event_cleanup]', [event, actor]); }
function noReward(p) { assert.equal(p.invTotal(inv, requiredId(types.ObjType, 'macro_genilamp')), 0); }
function cleared(p) {
  assert.equal(p.getVar(v('macro_event')), 0);
  for (const name of ['macro_event_uid', 'macro_event_origin_coord', 'macro_event_target_coord']) assert.equal(p.getVar(v(name)), -1, name);
  noReward(p);
}
const admissionStates = ['free', 'npc combat', 'multiple attackers', 'pvp combat', 'modal', 'delayed', 'unavailable', 'another event active'];
function admissionEffects(kind, root = '[timer,general_macro_events]') {
  const p = player(), attackers = [];
  const random = JavaRandom.nextDouble, selectorRandom = ScriptRunner.HANDLERS[op.RANDOM], enabled = Environment.NODE_RANDOM_EVENTS;
  // Labelled packed-only readiness/state boundaries. Enable AFK_EVENT only in
  // this process and fix the existing selector's RNG to Genie, not its result.
  Environment.NODE_RANDOM_EVENTS = true;
  JavaRandom.nextDouble = () => 0.2;
  ScriptRunner.HANDLERS[op.RANDOM] = state => {
    if (state.script.name !== '[proc,macro_event_set_random]') return selectorRandom(state);
    state.popInt();
    state.pushInt(1);
  };
  try {
    if (kind === 'npc combat' || kind === 'multiple attackers') {
      p.setVar(v('lastcombat'), World.currentTick);
      for (let i = 0; i < (kind === 'multiple attackers' ? 2 : 1); i++) {
        const type = types.NpcType.get(81);
        const n = new Npc(p.level, p.x + i + 1, p.z, type.size, type.size, EntityLifeCycle.DESPAWN, World.getNextNid(), type.id, type.blockwalk);
        World.addNpc(n, 100);
        n.setVar(requiredId(types.VarNpcType, 'npc_aggressive_player'), p.uid);
        attackers.push(n);
      }
      p.setVar(v('aggressive_npc'), attackers[0].uid);
    }
    if (kind === 'pvp combat') p.setVar(v('lastcombat_pvp'), World.currentTick);
    if (kind === 'modal') p.openMainModal(requiredId(types.Component, 'welcome_screen'));
    if (kind === 'delayed') p.delayed = true;
    if (kind === 'unavailable') p.protect = true;
    if (kind === 'another event active') genie(p);
    p.afkEventReady = true;
    run(p, root, root.startsWith('[timer,') ? [] : [2], { protect: false });
    const owned = [...World.npcs].filter(n => n.isActive && n.getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')) === (p.uid | 0));
    const result = {
      identity: p.getVar(v('macro_event')), ready: p.afkEventReady,
      actors: owned.map(n => types.NpcType.get(n.type).debugname).sort(),
      uidMatches: owned.length === 1 && owned[0].uid === p.getVar(v('macro_event_uid')),
      tile: [p.level, p.x, p.z], modal: p.modalMain, delayed: p.delayed, protect: p.protect,
      inventory: snapshot(p).inventory, queues: snapshot(p).queues
    };
    return result;
  } finally {
    JavaRandom.nextDouble = random; Environment.NODE_RANDOM_EVENTS = enabled;
    ScriptRunner.HANDLERS[op.RANDOM] = selectorRandom;
    for (const n of [...World.npcs]) if (n.isActive && (attackers.includes(n) || n.getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')) === (p.uid | 0))) World.removeNpc(n, -1);
  }
}
const admissionHead = new Map();
const admissionRoots = ['[timer,general_macro_events]', '[proc,macro_event_general_spawn]'];
for (const root of admissionRoots) for (const kind of admissionStates) check(`published Genie admission is preserved: ${root} ${kind}`, () => {
  const result = admissionEffects(kind, root);
  admissionHead.set(`${root}:${kind}`, result);
  assert.equal(result.identity, 2);
  assert.deepEqual(result.actors, ['macro_geni']);
  assert.equal(result.uidMatches, true);
  assert.equal(result.ready, !root.startsWith('[timer,') || kind === 'another event active', 'only a served timer roll consumes readiness');
  assert.equal(result.modal, kind === 'modal' ? requiredId(types.Component, 'welcome_screen') : -1);
  assert.equal(result.delayed, kind === 'delayed');
  assert.deepEqual(result.queues, [[], [], []], 'no new retry queue');
});
check('failed NPC allocation writes no event identity or actor state', () => {
  const p = player(), before = snapshot(p);
  const add = ScriptRunner.HANDLERS[op.NPC_ADD];
  // The real allocator throws when its pool is exhausted. This seam makes that
  // same failure deterministic without allocating every slot in the world.
  ScriptRunner.HANDLERS[op.NPC_ADD] = state => { state.popInts(3); throw new Error('labelled packed-only allocation failure'); };
  try {
    const state = ScriptRunner.init(packed('[proc,macro_event_general_spawn]'), p, null, [2]);
    p.runScript(state, false);
    assert.equal(state.execution, ScriptState.ABORTED);
    const after = snapshot(p);
    assert.equal(after.messages.length, 5, 'only the VM allocation-error diagnostic is emitted');
    assert.deepEqual(after.messages.slice(0, 3), [
      { msg: 'script error: npc_add labelled packed-only allocation failure' },
      { msg: 'file: macro_events.rs2' }, { msg: 'stack backtrace:' }
    ]);
    assert.match(after.messages[3].msg, /^    1: \[proc,macro_event_general_create\] - macro_events\.rs2:\d+$/);
    assert.match(after.messages[4].msg, /^    2: \[proc,macro_event_general_spawn\] - macro_events\.rs2:\d+$/);
    assert.deepEqual({ ...after, messages: before.messages }, before, 'NPC_ADD must precede every encounter-state write');
  } finally { ScriptRunner.HANDLERS[op.NPC_ADD] = add; }
});
for (const [tile, area] of [[[0, 2000, 4740], 'Mime'], [[0, 2900, 4550], 'Maze'], [[0, 2338, 4747], 'Lost and Found']]) check(`event-area admission uses packed zone row: ${area}`, () => {
  const p = player(tile);
  const before = snapshot(p);
  run(p, '[proc,macro_event_general_spawn]', [2], { protect: false });
  assert.deepEqual(snapshot(p), before);
});
function startTask(p) {
  run(p, '[proc,macro_laf_start]', [D], { protect: false });
  assert.equal(p.getVar(v('macro_event')), laf);
  assert.equal(p.getVar(v('macro_event_origin_coord')), coord(...O));
  assert.equal(p.getVar(v('macro_event_target_coord')), D);
  assert.deepEqual([p.level, p.x, p.z], [0, 2338, 4747]);
  p.closeModal();
}
for (const combatVar of ['lastcombat', 'lastcombat_pvp']) check(`owned task retains published combat admission: ${combatVar}`, () => {
  const p = player();
  p.setVar(v(combatVar), World.currentTick);
  startTask(p);
  cleanup(p);
});
check('genuine task entry keeps O/D and survives logout/login without overwrite', () => {
  const p = player(); startTask(p);
  const identity = [p.getVar(v('macro_event')), p.getVar(v('macro_event_origin_coord')), p.getVar(v('macro_event_target_coord')), p.getVar(v('macro_transmit'))];
  run(p, '[proc,macro_event_logout]');
  // Reconnect copies only real persistent fields into a fresh player, as login does.
  const reconnected = player([p.level, p.x, p.z]);
  for (let id = 0; id < p.vars.length; id++) if (types.VarPlayerType.get(id).scope === types.VarPlayerType.SCOPE_PERM) reconnected.vars[id] = p.vars[id];
  run(reconnected, '[queue,macro_event_login]');
  assert.deepEqual([reconnected.getVar(v('macro_event')), reconnected.getVar(v('macro_event_origin_coord')), reconnected.getVar(v('macro_event_target_coord')), reconnected.getVar(v('macro_transmit'))], identity);
  for (const tab of [0, 1, 2, 3, 4, 5, 6, 11, 12]) assert.equal(reconnected.tabs[tab], -1);
  const before = snapshot(reconnected);
  run(reconnected, '[proc,macro_event_general_spawn]', [2], { protect: false });
  run(reconnected, '[proc,macro_laf_start]', [coord(1, 3000, 3000)], { protect: false });
  assert.deepEqual(snapshot(reconnected), before, 'neither follower nor task admission overwrites a task');
  cleanup(reconnected); cleanup(p);
});
check('configured follower logout restoration preserves origin and excludes another event', () => {
  const p = player(); const old = genie(p);
  const origin = p.getVar(v('macro_event_origin_coord'));
  run(p, '[proc,macro_event_logout]');
  assert.equal(old.getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')), -1);
  p.setVar(v('macro_event_uid'), -1);
  run(p, '[queue,macro_event_login]');
  const restored = World.getNpcByUid(p.getVar(v('macro_event_uid')));
  assert(restored && restored.uid !== old.uid);
  assert.equal(p.getVar(v('macro_event_origin_coord')), origin);
  const before = snapshot(p);
  run(p, '[proc,macro_event_general_spawn]', [2], { protect: false });
  assert.deepEqual(snapshot(p), before);
  cleanup(p); World.removeNpc(old, -1);
});
function completeCandlelight(p) {
  // Labelled packed-only progress setup reaches the real Pete completion branch.
  for (let i = 1; i <= 11; i++) p.setVarBit(requiredId(types.VarBitType, `macro_candlelight_${i}`), 1);
  p.setVar(v('macro_transmit'), 1);
  const nextRandom = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => 0.5;
  try {
    const pete = [...World.npcs].find(n => n.isActive && n.type === requiredId(types.NpcType, 'macro_pious_pete'));
    assert(pete, 'Pete is a real static NPC');
    const completion = ScriptRunner.init(packed('[opnpc1,macro_pious_pete]'), p, pete);
    p.executeScript(completion, true);
    assert.equal(completion.execution, ScriptState.PAUSEBUTTON);
    assert(new ResumePauseButtonHandler().handle(new ResumePauseButton(0), p));
    assert.equal(completion.execution, ScriptState.FINISHED);
  } finally { JavaRandom.nextDouble = nextRandom; }
}

check('Candlelight relog preserves identity, hides tabs and deletes the owned taper', () => {
  const p = player();
  run(p, '[proc,macro_event_general_spawn]', [5], { protect: false });
  assert.equal(p.getVar(v('macro_event')), 5);
  assert.equal(p.getVar(v('macro_event_target_coord')), coord(...O));
  run(p, '[proc,macro_event_logout]');
  let reconnected = player([p.level, p.x, p.z]);
  for (let id = 0; id < p.vars.length; id++) if (types.VarPlayerType.get(id).scope === types.VarPlayerType.SCOPE_PERM) reconnected.vars[id] = p.vars[id];
  run(reconnected, '[queue,macro_event_login]');
  assert.equal(reconnected.getVar(v('macro_event')), 5);
  assert.equal(reconnected.getVar(v('macro_event_target_coord')), coord(...O));
  for (const tab of [0, 1, 2, 3, 4, 5, 6, 11, 12]) assert.equal(reconnected.tabs[tab], -1, 'relogin inside church hides the Magic tab');
  const start = run(reconnected, '[proc,macro_candlelight_start]');
  if (start.execution === ScriptState.PAUSEBUTTON) assert(new ResumePauseButtonHandler().handle(new ResumePauseButton(0), reconnected));
  assert.equal(start.execution, ScriptState.FINISHED);
  const taperUid = reconnected.getVar(v('macro_event_uid'));
  const taper = World.getNpcByUid(taperUid);
  assert(taper, 'Candlelight start creates the real owned taper');
  assert.equal(taper.type, requiredId(types.NpcType, 'macro_candle_taper'));
  assert.equal(taper.getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')), reconnected.uid | 0);
  run(reconnected, '[proc,macro_event_logout]');
  assert.equal(World.getNpcByUid(taperUid), null, 'logout deletes the exact taper');
  assert.equal(reconnected.getVar(v('macro_event_uid')), -1);
  const loggedOut = reconnected;
  reconnected = player([loggedOut.level, loggedOut.x, loggedOut.z]);
  for (let id = 0; id < loggedOut.vars.length; id++) if (types.VarPlayerType.get(id).scope === types.VarPlayerType.SCOPE_PERM) reconnected.vars[id] = loggedOut.vars[id];
  run(reconnected, '[queue,macro_event_login]');
  assert.equal(reconnected.getVar(v('macro_event')), 5);
  assert.equal(reconnected.getVar(v('macro_event_target_coord')), coord(...O));
  for (const tab of [0, 1, 2, 3, 4, 5, 6, 11, 12]) assert.equal(reconnected.tabs[tab], -1);
  completeCandlelight(reconnected);
  assert.deepEqual([reconnected.level, reconnected.x, reconnected.z], O);
  assert.equal(reconnected.invTotal(inv, requiredId(types.ObjType, 'uncut_sapphire')), 1);
  cleared(reconnected);
  cleanup(p); cleanup(loggedOut);
});
check('Candlelight relog outside the church cleans the stranded event', () => {
  const p = player();
  run(p, '[proc,macro_event_general_spawn]', [5], { protect: false });
  const outside = [0, 30 * 64 + 7, 78 * 64 + 11]; // Leo's west-side graveyard tile, outside the church.
  [p.level, p.x, p.z] = outside;
  run(p, '[proc,macro_event_logout]');
  const reconnected = player(outside);
  for (let id = 0; id < p.vars.length; id++) if (types.VarPlayerType.get(id).scope === types.VarPlayerType.SCOPE_PERM) reconnected.vars[id] = p.vars[id];
  run(reconnected, '[queue,macro_event_login]');
  cleared(reconnected);
  assert.deepEqual([reconnected.level, reconnected.x, reconnected.z], outside);
  cleanup(p);
});
check('Candlelight map-zone exit clears progress and encounter state', () => {
  const p = player([0, 1972, 5003]);
  p.setVar(v('macro_event'), 5);
  p.setVar(v('macro_event_uid'), -1);
  p.setVar(v('macro_event_target_coord'), coord(...O));
  p.setVar(v('macro_event_origin_coord'), coord(...O));
  p.setVar(v('macro_transmit'), 13);
  run(p, '[mapzoneexit,0_30_78]');
  cleared(p);
});
for (const [label, missing] of [['null', -1], ['0_0_0_0_0', 0]]) check(`Candlelight ${label} departure recovers to Lumbridge`, () => {
  const p = player();
  run(p, '[proc,macro_event_general_spawn]', [5], { protect: false });
  p.setVar(v('macro_event_target_coord'), missing);
  completeCandlelight(p);
  assert.deepEqual([p.level, p.x, p.z], [0, 50 * 64 + 22, 50 * 64 + 18]);
  cleared(p);
});
check('Candlelight full inventory stores its reward in the bank', () => {
  const p = player();
  run(p, '[proc,macro_event_general_spawn]', [5], { protect: false });
  const dagger = requiredId(types.ObjType, 'bronze_dagger');
  const reward = requiredId(types.ObjType, 'uncut_sapphire');
  for (let i = 0; i < 28; i++) p.invAdd(inv, dagger, 1);
  const inventoryBefore = snapshot(p).inventory;
  assert.equal(inventoryBefore.filter(Boolean).length, 28);
  completeCandlelight(p);
  assert.deepEqual(snapshot(p).inventory, inventoryBefore);
  assert.equal(p.invTotal(bank, reward), 1);
  assert.deepEqual([p.level, p.x, p.z], O);
  cleared(p);
});
check('Candlelight full inventory and bank drops its reward at the return tile', () => {
  const p = player();
  run(p, '[proc,macro_event_general_spawn]', [5], { protect: false });
  const dagger = requiredId(types.ObjType, 'bronze_dagger');
  const reward = requiredId(types.ObjType, 'uncut_sapphire');
  for (let i = 0; i < 28; i++) p.invAdd(inv, dagger, 1);
  const bankSize = types.InvType.get(bank).size;
  const fillers = types.ObjType.configs.filter(item => item?.tradeable && item.dummyitem === 0
    && item.certtemplate === -1 && item.id !== reward).slice(0, bankSize);
  assert.equal(fillers.length, bankSize, 'packed ordinary item types can fill the native bank');
  for (const [slot, item] of fillers.entries()) p.invSet(bank, item.id, 1, slot);
  const inventoryBefore = snapshot(p).inventory;
  completeCandlelight(p);
  assert.deepEqual(snapshot(p).inventory, inventoryBefore);
  assert.equal(p.invTotal(bank, reward), 0);
  assert.deepEqual([p.level, p.x, p.z], O);
  const ground = World.getObj(O[1], O[2], O[0], reward, p.hash64);
  assert(ground, 'the unbankable reward is visible at the return tile');
  assert.equal(ground.count, 1);
  cleared(p);
});
check('old Genie failure queue cannot clear or move a newer Lost and Found task', () => {
  const p = player(); run(p, '[proc,initalltabs]'); const n = genie(p);
  p.openMainModal(requiredId(types.Component, 'welcome_screen'));
  // Labelled packed-only timer setup: reach the real third-warning failure.
  n.setVar(requiredId(types.VarNpcType, 'npc_int'), 3);
  const timer = ScriptRunner.init(packed('[ai_timer,macro_geni]'), n);
  ScriptRunner.execute(timer);
  assert.notEqual(timer.execution, ScriptState.ABORTED);
  const queued = [...p.queue.all()].find(q => q.script.name === '[queue,macro_event_fail_teleport]');
  assert(queued, 'the real Genie timer queued the failure');
  assert.deepEqual(queued.args, [0, n.uid], 'queue carries the released identity and exact actor');
  p.closeModal(); startTask(p);
  const before = snapshot(p);
  p.processQueues();
  assert.deepEqual(snapshot(p), { ...before, queues: [[], before.queues[1], before.queues[2]] }, 'stale failure is consumed without touching the newer task');
  assert.equal(p.activeScript, null);
  cleanup(p); World.removeNpc(n, -1);
});
check('current Genie failure still teleports once and a changed actor token is inert', () => {
  const p = player(); const n = genie(p);
  p.setVar(v('macro_event'), 0); // labelled state at the existing failure boundary
  const before = snapshot(p);
  run(p, '[queue,macro_event_fail_teleport]', [0, n.uid + 1]);
  assert.deepEqual(snapshot(p), before, 'equal identity alone cannot authorize an old actor');
  run(p, '[queue,macro_event_fail_teleport]', [0, n.uid]);
  assert.notDeepEqual([p.level, p.x, p.z], O);
  assert.equal(p.getVar(v('macro_event')), 0); noReward(p);
  World.removeNpc(n, -1);
});
check('two simultaneous followers have independent ownership; stale cleanup is inert', () => {
  const a = player(); const b = player(); const an = genie(a); const bn = genie(b);
  assert.notEqual(an.uid, bn.uid);
  const beforeA = snapshot(a); const beforeB = snapshot(b);
  cleanup(a, 2, bn.uid);
  cleanup(a, laf, an.uid);
  assert.deepEqual(snapshot(a), beforeA);
  assert.deepEqual(snapshot(b), beforeB);
  cleanup(a);
  cleared(a);
  assert(World.getNpcByUid(bn.uid));
  assert.equal(b.getVar(v('macro_event_uid')), bn.uid);
  cleanup(b); cleared(b);
});
check('logout cannot detach a different owner even with a stale actor reference', () => {
  const a = player(); const b = player(); const bn = genie(b);
  a.setVar(v('macro_event_uid'), bn.uid);
  run(a, '[proc,macro_event_logout]');
  assert.equal(bn.getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')), b.uid | 0);
  cleanup(b);
});
function followerDeathEffects() {
  const p = player([0, 3252, 3288]), n = genie(p);
  for (const item of ['bronze_pickaxe', 'airrune', 'lawrune']) give(p, item);
  const random = Math.random; Math.random = () => 0.5;
  try { run(p, '[queue,player_death_default]'); }
  finally { Math.random = random; }
  assert.equal(p.getVar(v('macro_event')), 2, 'death leaves the follower identity to its own logic');
  assert.equal(World.getNpcByUid(n.uid)?.isActive, true);
  const timer = ScriptRunner.init(packed('[ai_timer,macro_geni]'), n);
  ScriptRunner.execute(timer);
  assert.equal(timer.execution, ScriptState.FINISHED);
  assert.equal(p.getVar(v('macro_event_uid')), n.uid);
  assert.equal(n.level, p.level);
  assert(Math.max(Math.abs(n.x - p.x), Math.abs(n.z - p.z)) <= 1, 'published macro_event_lost follows to respawn');
  noReward(p);
  const talk = ScriptRunner.init(packed('[opnpc1,macro_geni]'), p, n);
  p.executeScript(talk, true);
  assert.equal(talk.execution, ScriptState.PAUSEBUTTON);
  assert(new ResumePauseButtonHandler().handle(new ResumePauseButton(0), p));
  assert.equal(talk.execution, ScriptState.FINISHED);
  const result = {
    tile: [p.level, p.x, p.z], identity: p.getVar(v('macro_event')),
    actor: types.NpcType.get(n.type).debugname, warning: n.getVar(requiredId(types.VarNpcType, 'npc_int')),
    inventory: snapshot(p).inventory
  };
  assert.equal(result.identity, 0);
  assert.equal(p.invTotal(inv, requiredId(types.ObjType, 'macro_genilamp')), 1);
  World.removeNpc(n, -1);
  return result;
}
let followerDeathHead;
check('published follower survives owner death, follows respawn and grants its lamp', () => {
  followerDeathHead = followerDeathEffects();
});
check('task death with a reused uid cannot delete another owner actor', () => {
  const a = player(); const b = player(); const bn = genie(b);
  startTask(a);
  // Labelled reused-slot boundary, matching the reviewer's stale-UID scenario.
  a.setVar(v('macro_event_uid'), bn.uid);
  const otherBefore = snapshot(b);
  run(a, '[queue,player_death_default]');
  cleared(a);
  assert.equal(World.getNpcByUid(bn.uid)?.isActive, true);
  assert.equal(bn.getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')), b.uid | 0);
  assert.deepEqual(snapshot(b), otherBefore);
  cleanup(b);
});
check('task death keeps normal location/items and cannot complete after reconnect', () => {
  const p = player(); for (const item of ['bronze_pickaxe', 'airrune', 'lawrune']) give(p, item);
  startTask(p);
  run(p, '[queue,player_death_default]');
  cleared(p);
  const [plane, x, z] = [p.level, p.x, p.z];
  assert.equal(p.getVar(v('macro_transmit')), 0, 'Lost and Found death clears its generated client progress');
  for (const tab of [3, 4, 6]) assert(p.tabs[tab] >= 0, 'normal interfaces return at death');
  assert.equal(plane, 0); assert(Math.abs(x - 3221) <= 2 && Math.abs(z - 3218) <= 2);
  assert.deepEqual(contents(snapshot(p).inventory), contents(noEventResults.get('[queue,player_death_default]').inventory));
  run(p, '[queue,macro_event_login]');
  const before = snapshot(p); run(p, '[proc,macro_laf_complete]');
  assert.deepEqual(snapshot(p), before);
});
check('real normal teleport aborts task at exact destination with no reward', () => {
  const p = player(); startTask(p);
  run(p, '[proc,player_teleport_normal]', [D]);
  assert.deepEqual([p.level, p.x, p.z], [0, 3213, 3424]);
  cleared(p);
  run(p, '[queue,macro_event_login]'); cleared(p);
});
check('ordinary teleport retains a follower and its owned actor follows', () => {
  const p = player(); const n = genie(p);
  run(p, '[proc,player_teleport_normal]', [D]);
  assert.equal(p.getVar(v('macro_event')), 2);
  assert.equal(p.getVar(v('macro_event_uid')), n.uid);
  const result = run(p, '[proc,macro_event_lost]', [], { npc: n, protect: false });
  assert.equal(result.popInt(), 0);
  assert.equal(n.level, p.level);
  assert(Math.abs(n.x - p.x) <= 1 && Math.abs(n.z - p.z) <= 1);
  cleanup(p);
});
check('Lost and Found completion returns to D once without changing compensation', () => {
  const p = player(); startTask(p);
  run(p, '[proc,macro_laf_complete]');
  assert.deepEqual([p.level, p.x, p.z], [0, 3213, 3424]);
  cleared(p);
  p.closeModal(); const before = snapshot(p);
  run(p, '[proc,macro_laf_complete]');
  assert.deepEqual(snapshot(p), before);
});
check('an unrelated map exit or unowned lever cannot clear/advance a follower', () => {
  const p = player(); const n = genie(p);
  const before = snapshot(p);
  run(p, '[mapzoneexit,0_36_74]');
  run(p, '[proc,check_appendages]', [0]);
  run(p, '[proc,macro_events_varps_reset]');
  assert.deepEqual(snapshot(p), before);
  assert(World.getNpcByUid(n.uid)); cleanup(p);
});
check('legacy saved zero origin stays unknown and never becomes a return to 0,0', () => {
  const p = player(); startTask(p);
  p.setVar(v('macro_event_origin_coord'), 0);
  run(p, '[queue,macro_event_login]');
  assert.equal(p.getVar(v('macro_event')), laf);
  assert.equal(p.getVar(v('macro_event_origin_coord')), -1);
  assert.equal(p.getVar(v('macro_event_target_coord')), D);
  assert.deepEqual([p.level, p.x, p.z], [0, 2338, 4747]);
  run(p, '[proc,macro_laf_complete]');
  assert.deepEqual([p.level, p.x, p.z], [0, 3213, 3424]);
  cleared(p);
});
for (const populated of [false, true]) check(`read-only staff inventory fixture: ${populated ? 'stack boundary and long object name' : 'empty inventory'}`, () => {
  const p = player(); const other = player();
  run(p, '[login,_]');
  give(other, 'airrune', 9);
  if (populated) {
    const longest = readFileSync(new URL('../../pack/obj.pack', import.meta.url), 'utf8').split('\n').reduce((name, line) => {
      const candidate = line.slice(line.indexOf('=') + 1);
      return candidate.length > name.length ? candidate : name;
    }, '');
    give(p, 'coins', 2147483647); give(p, 'airrune', 3); give(p, longest);
    assert.equal(p.invTotal(inv, requiredId(types.ObjType, 'coins')), 2147483647);
    assert.equal(p.invTotal(inv, requiredId(types.ObjType, 'airrune')), 3);
    assert.equal(p.invTotal(inv, requiredId(types.ObjType, longest)), 1);
  }
  p.messages = [];
  const before = snapshot(p); const otherBefore = snapshot(other);
  const expected = ['[inv_readback] begin'];
  let occupied = 0;
  before.inventory.forEach((item, slot) => {
    if (!item) return;
    const [name, count] = item;
    expected.push(`[inv_readback] slot=${slot} count=${count}`);
    for (let offset = 0; offset < name.length; offset += 40) expected.push(`[inv_readback] objpart=${name.slice(offset, offset + 40)}`);
    occupied++;
  });
  expected.push(`[inv_readback] end=${occupied}`);
  assert.equal(packed('[debugproc,inv_readback]').info.parameterTypes.length, 0, 'the fixture cannot name another player');
  run(p, '[debugproc,inv_readback]', [], { protect: false });
  assert.deepEqual(p.messages.map(packet => packet.msg), expected);
  assert(p.messages.every(packet => packet.msg.length <= 70), 'every emitted line is safe for the client');
  const after = snapshot(p); after.messages = [];
  assert.deepEqual(after, before, 'inventory, varps, queues, actors and UI are unchanged');
  assert.deepEqual(snapshot(other), otherBefore, 'no other player is read or changed');
});
check('real packed Teleother cast and visible consent release only the owned task', () => {
  const recipient = player(); const other = player(); const caster = player([0, 2336, 4746]);
  for (const p of [recipient, caster]) run(p, '[proc,initalltabs]');
  recipient.setVar(v('option_aid'), 1);
  give(recipient, 'coins', 17);
  for (const rune of ['soulrune', 'lawrune', 'earthrune']) give(caster, rune, 2);
  startTask(recipient); startTask(other);
  run(recipient, '[mapzone,0_36_74]');
  run(caster, '[mapzone,0_36_74]');
  for (const tab of [3, 4, 6]) {
    assert.equal(recipient.tabs[tab], -1);
    assert(caster.tabs[tab] >= 0, 'the no-event visitor retains normal interfaces');
  }
  const otherBefore = snapshot(other);
  const inventoryBefore = snapshot(recipient).inventory;
  const xpBefore = caster.stats[PlayerStat.MAGIC];
  const component = requiredId(types.Component, 'magic:com_511');
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.APPLAYERT, component, -1);
  assert.equal(trigger, packed('[applayert,magic:com_511]'));
  assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.OPPLAYERT, component, -1), undefined);
  assert.equal(caster.inApproachDistance(10, recipient), false, 'this task has no ordinary legal caster approach');
  // Ruling 9: execute the real AP body to prove the landed-cast predicate,
  // not the unreachable physical approach. No spell, offer or task is mocked.
  const cast = ScriptRunner.init(trigger, caster, recipient);
  caster.executeScript(cast, true);
  assert.equal(cast.execution, ScriptState.FINISHED);
  assert.equal(caster.stats[PlayerStat.MAGIC] - xpBefore, 840);
  for (const rune of ['soulrune', 'lawrune', 'earthrune']) assert.equal(caster.invTotal(inv, requiredId(types.ObjType, rune)), 1);
  assert.equal(recipient.getVar(v('teleother_spell')), 61);
  assert.equal(recipient.modalMain, requiredId(types.Component, 'teleport_option'));
  assert.equal(recipient.getVar(v('macro_event')), laf, 'an offer alone cannot abort the task');
  const casterAfterCast = snapshot(caster);
  const accept = requiredId(types.Component, 'teleport_option:com_97');
  const buttons = new IfButtonHandler();
  assert.equal(buttons.handle(new IfButton(accept), recipient), true);
  let boundaries = 0;
  while (recipient.activeScript) {
    assert(boundaries++ < 10, 'finite real consent delay');
    const state = recipient.activeScript;
    assert.equal(state.execution, ScriptState.SUSPENDED);
    assert(recipient.delayed && recipient.delayedUntil > World.currentTick);
    World.currentTick = recipient.delayedUntil;
    recipient.delayed = false;
    recipient.executeScript(state, true, true);
  }
  assert.equal(recipient.level, 0);
  assert(Math.abs(recipient.x - 3221) <= 2 && Math.abs(recipient.z - 3218) <= 2);
  cleared(recipient);
  assert.equal(recipient.getVar(v('macro_transmit')), 0);
  assert.equal(recipient.getVar(v('teleother_spell')), 0);
  assert.deepEqual(snapshot(recipient).inventory, inventoryBefore);
  for (const tab of [3, 4, 6]) assert(recipient.tabs[tab] >= 0);
  assert.deepEqual(snapshot(caster), casterAfterCast, 'consent cannot charge or mutate the caster again');
  assert.equal(caster.stats[PlayerStat.MAGIC], xpBefore + 840);
  assert.deepEqual(snapshot(other), otherBefore, 'another owned task is untouched');
  const after = snapshot(recipient);
  assert.equal(buttons.handle(new IfButton(accept), recipient), false, 'closed consent interface cannot be replayed');
  assert.deepEqual(snapshot(recipient), after);
  assert.deepEqual(snapshot(caster), casterAfterCast);
  assert.deepEqual(snapshot(other), otherBefore);
  cleanup(other);
});
// F1 identity census. These are labelled packed-only saved-state boundary seeds,
// not live entry evidence. Values 1 and 6 can clear during their own spawn bodies.
// Every positive identity in the published constants is exercised, including
// triffidseed/bigfish's shared value 6. NPC action sentinels are not identities.
const identityRoots = ['[queue,macro_event_login]', '[proc,macro_event_logout]', '[queue,player_death_default]', '[proc,p_telejump_safe]'];
function identityEffects(identity, root, tile = identity === 5 ? [0, 1972, 5003] : O) {
  const p = player(tile);
  p.setVar(v('macro_event'), identity);
  p.setVar(v('macro_event_target_coord'), D);
  p.setVar(v('macro_transmit'), 13);
  const random = Math.random;
  Math.random = () => 0.5;
  try { run(p, root, root === '[proc,p_telejump_safe]' ? [D] : []); }
  finally { Math.random = random; }
  const result = {
    identity: p.getVar(v('macro_event')), target: p.getVar(v('macro_event_target_coord')),
    progress: p.getVar(v('macro_transmit')), tile: [p.level, p.x, p.z],
    inventory: snapshot(p).inventory,
    actors: [...World.npcs].filter(n => n.isActive && n.getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')) === (p.uid | 0)).map(n => types.NpcType.get(n.type).debugname).sort()
  };
  for (const n of [...World.npcs]) if (n.getVar(requiredId(types.VarNpcType, 'npc_macro_event_target')) === (p.uid | 0)) World.removeNpc(n, -1);
  return result;
}
const identityHead = new Map();
for (let identity = 0; identity <= 6; identity++) for (const root of identityRoots) check(`published identity ${identity} lifecycle ${root}`, () => {
  const result = identityEffects(identity, root);
  identityHead.set(`${identity}:${root}`, result);
  const afterLogin = root.includes('login') && ![0, 2, 4, 5].includes(identity);
  assert.equal(result.identity, afterLogin ? 0 : identity);
  assert.equal(result.target, D);
  assert.equal(result.progress, 13, 'U01 does not reset another event progress word');
});
const castleWars = [0, 2378, 9482];
const castleWarsHead = new Map();
for (const identity of [2, 4]) check(`published follower ${identity} Castle Wars login retains stale destination`, () => {
  const result = identityEffects(identity, '[queue,macro_event_login]', castleWars);
  castleWarsHead.set(identity, result);
  assert.equal(result.identity, 0);
  assert.equal(result.target, D);
  assert.equal(result.progress, 13);
  assert.deepEqual(result.tile, castleWars);
  assert.deepEqual(result.actors, []);
});
if (process.env.U01_PUBLISHED_PACK) {
  reload(process.env.U01_PUBLISHED_PACK);
  try {
    for (let identity = 0; identity <= 6; identity++) for (const root of identityRoots) check(`published-pack comparison identity ${identity} ${root}`, () => {
      const published = identityEffects(identity, root), actual = identityHead.get(`${identity}:${root}`);
      const expected = { ...published };
      if (identity === 5 && root.includes('login')) expected.identity = 5; // plan 1332, F1
      console.log(`IDENTITY_COMPARISON ${JSON.stringify({ identity, root, published, actual })}`);
      assert.deepEqual(actual, expected, 'only F1 Candlelight identity retention may differ');
    });
    for (const identity of [2, 4]) check(`published-pack follower ${identity} Castle Wars login comparison`, () => {
      const published = identityEffects(identity, '[queue,macro_event_login]', castleWars), actual = castleWarsHead.get(identity);
      console.log(`CASTLE_WARS_COMPARISON ${JSON.stringify({ identity, published, actual })}`);
      assert.deepEqual(actual, published);
    });
    for (const root of admissionRoots) for (const kind of admissionStates) check(`published-pack admission comparison: ${root} ${kind}`, () => {
      const published = admissionEffects(kind, root), actual = admissionHead.get(`${root}:${kind}`);
      console.log(`ADMISSION_COMPARISON ${JSON.stringify({ root, kind, published, actual })}`);
      assert.deepEqual(actual, published);
    });
    check('published-pack follower death, respawn and lamp comparison', () => {
      const published = followerDeathEffects();
      console.log(`FOLLOWER_DEATH_COMPARISON ${JSON.stringify({ published, actual: followerDeathHead })}`);
      assert.deepEqual(followerDeathHead, published);
    });
  } finally { reload(pack); }
}
console.log(`RESULT ${failed ? 'FAIL' : 'PASS'} random-events-u01 passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
