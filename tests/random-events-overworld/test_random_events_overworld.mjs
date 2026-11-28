import assert from 'node:assert/strict';
import { player as makePlayer, World, ScriptProvider, ScriptState, ServerTriggerType, PlayerStat, types, id, obj, inv, count, inventory, held, button, resumeDialogue, dialoguePage, engineModule, map } from '../swamp-caves/runtime.mjs';

const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const { ScriptOpcode: op } = await engineModule('engine/script/ScriptOpcode.ts');
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const v = name => id('VarPlayerType', name);
const nv = name => id('VarNpcType', name);
const O = [0, 3222, 3218];
const tile = p => [p.level, p.x, p.z];
const packed = name => { const script = ScriptProvider.getByName(name); assert(script, `packed ${name}`); return script; };
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
function player(level = 99) {
  const p = makePlayer();
  [p.level, p.x, p.z] = O;
  p.baseLevels.fill(level); p.levels.fill(level);
  p.baseLevels[PlayerStat.HITPOINTS] = Math.max(10, level);
  p.levels[PlayerStat.HITPOINTS] = Math.max(10, level);
  p.buildArea.originX = Math.floor(p.x / 8) * 8;
  p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  run(p, '[proc,initalltabs]');
  return p;
}
function give(p, name, quantity = 1) { p.invAdd(inv, obj(name), quantity); }
function run(p, name, args = [], npc = null) {
  const state = ScriptRunner.init(packed(name), p, npc, args);
  p.executeScript(state, true, true);
  advance(p, state);
  return state;
}
function advance(p, state, inspect = null) {
  for (let n = 0; state.execution === ScriptState.SUSPENDED && n < 80; n++) {
    inspect?.();
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    p.delayed = false;
    p.executeScript(state, true, true);
  }
  assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} aborts`);
  assert.notEqual(state.execution, ScriptState.SUSPENDED, `${state.script.name} exceeds delay bound`);
}
function finish(p, choices = [], inspect = null) {
  for (let n = 0; p.activeScript && n < 60; n++) {
    inspect?.();
    const state = p.activeScript;
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat).comName;
      resumeDialogue(p, /^multi[2-5]$/.test(root) ? (choices.shift() ?? 1) : null);
    } else advance(p, state, inspect);
    assert.notEqual(state.execution, ScriptState.ABORTED);
  }
  assert.equal(p.activeScript, null, 'bounded dialogue completes');
  assert.equal(choices.length, 0, 'all explicit choices were offered');
  inspect?.();
}
function talk(p, n, choices = [], inspect = null) {
  p.target = n; p.targetOp = ServerTriggerType.APNPC1;
  const script = p.getOpTrigger();
  assert(script, `native Talk-to ${types.NpcType.get(n.type).debugname}`);
  const state = ScriptRunner.init(script, p, n);
  p.executeScript(state, true, true);
  advance(p, state, inspect);
  finish(p, choices, inspect);
  return state;
}
function ai(n, trigger = 'ai_timer', target = null, args = []) {
  const name = types.NpcType.get(n.type).debugname;
  const script = ScriptProvider.getByTrigger(ServerTriggerType[trigger.toUpperCase()], n.type, types.NpcType.get(n.type).category);
  assert(script, `visible ${name} resolves ${trigger} through production dispatch`);
  const state = ScriptRunner.init(script, n, target, args);
  n.executeScript(state);
  for (let i = 0; state.execution === ScriptState.NPC_SUSPENDED && i < 80; i++) {
    World.currentTick = Math.max(World.currentTick + 1, n.delayedUntil);
    n.delayed = false;
    n.executeScript(state);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${trigger} ${name} completes`);
  return state;
}
function spawn(p, event) {
  run(p, '[proc,macro_event_general_spawn]', [event]);
  assert.equal(p.getVar(v('macro_event')), event, `event ${event} admitted`);
  const n = World.getNpcByUid(p.getVar(v('macro_event_uid')));
  assert(n?.isActive, 'production spawner publishes a live actor');
  assert.equal(n.getVar(nv('npc_macro_event_target')), p.uid);
  return n;
}
function cleanup(p) {
  run(p, '[proc,macro_event_cleanup]', [p.getVar(v('macro_event')), p.getVar(v('macro_event_uid'))]);
}
function snapshot(p) { return { vars: [...p.vars], inv: inventory(p), tile: tile(p), form: p.npcId, modals: [p.modalMain, p.modalChat, p.modalSide], messages: [...p.messages] }; }
function owned(p, n, event) {
  assert.equal(p.getVar(v('macro_event')), event);
  assert.equal(p.getVar(v('macro_event_uid')), n.uid);
}
// Independent reward table: retained pre-target RuneHQ guide, herb/reward lines 110-137.
const herbExchanges = [
  ['guam_leaf', 'strength4'], ['marentill', '4doseantipoison'], ['tarromin', '4dose1attack'],
  ['harralander', '4dosestatrestore'], ['ranarr_weed', '4dose1energy'], ['toadflax', '4dose1defense'],
  ['irit_leaf', '4dose1agility'], ['avantoe', '4dose2strength'], ['kwuarm', '4dose2energy'],
  ['snapdragon', '4dose2strength'], ['cadantine', '4dose2restore'], ['lantadyme', '4dose2defense'],
  ['dwarf_weed', '4dose1magic']
];
for (const [herb, potion] of herbExchanges) check(`Jekyll native ${herb} exchange gives the period four-dose ${potion}`, () => {
  const p = player(); give(p, herb); const n = spawn(p, 10);
  if (herb === 'guam_leaf') {
    const other = player(), before = snapshot(other); talk(other, n);
    assert.deepEqual(snapshot(other), before); owned(p, n, 10); assert.equal(count(p, herb), 1);
  }
  talk(p, n);
  assert(p.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text === `Give ${types.ObjType.get(obj(herb)).name}`), 'the native request identifies the actual herb before it is consumed');
  assert.equal(count(p, herb), 0, 'only the genuinely carried requested herb is consumed');
  assert.equal(count(p, potion), 1, 'one original four-dose potion is received');
  pumpNpc(p, n, () => p.getVar(v('macro_event')) === 0 && !n.isActive, 24, 'successful Jekyll encounter departs');
  assert.deepEqual(tile(p), O);
});
for (const unused of [null, 'torstol', 'unidentified_guam']) check(`Jekyll ${unused ?? 'no herb'} fallback does not consume an unusable herb or become Hyde`, () => {
  const p = player(); if (unused) give(p, unused); const n = spawn(p, 10);
  talk(p, n);
  assert.equal(count(p, '2dose1strength'), 1);
  if (unused) assert.equal(count(p, unused), 1);
  assert.equal(n.type, id('NpcType', 'macro_jekyll'));
  pumpNpc(p, n, () => p.getVar(v('macro_event')) === 0 && !n.isActive, 24, 'fallback reward completes without hostility');
});
check('Jekyll native refusal preserves the herb and gives the period two-dose fallback', () => {
  const p = player(); give(p, 'guam_leaf'); const n = spawn(p, 10);
  talk(p, n, [2]);
  assert.equal(count(p, 'guam_leaf'), 1); assert.equal(count(p, '2dose1strength'), 1);
  assert.equal(n.type, id('NpcType', 'macro_jekyll'));
  pumpNpc(p, n, () => p.getVar(v('macro_event')) === 0 && !n.isActive, 24, 'refusal is not an invented transformation');
});
check('Jekyll can replace the requested herb in an otherwise full inventory without losing other items', () => {
  const p = player(); give(p, 'guam_leaf'); give(p, 'logs', 27); const n = spawn(p, 10);
  talk(p, n);
  assert.equal(count(p, 'guam_leaf'), 0); assert.equal(count(p, 'strength4'), 1); assert.equal(count(p, 'logs'), 27);
  assert.equal(inventory(p).filter(Boolean).length, 28);
  pumpNpc(p, n, () => p.getVar(v('macro_event')) === 0 && !n.isActive, 24, 'full-inventory herb exchange completes');
});
// Compiled-only branch fixtures replace individual RANDOM draws, not event state.
// Other scripts, including placement/pathfinding and the production caller, run unchanged.
function draws(spec, fn) {
  const original = ScriptRunner.HANDLERS[op.RANDOM];
  const remaining = Object.fromEntries(Object.entries(spec).map(([name, values]) => [name, [...values]]));
  ScriptRunner.HANDLERS[op.RANDOM] = state => {
    const values = remaining[state.script.name];
    if (!values?.length) return original(state);
    const bound = state.popInt(), value = values.shift();
    assert(value >= 0 && value < bound, `${state.script.name} draw ${value}/${bound}`);
    state.pushInt(value);
  };
  try { return fn(); } finally { ScriptRunner.HANDLERS[op.RANDOM] = original; }
}
function combatRolls(fn) {
  const original = JavaRandom.nextDouble;
  // Compiled fixture: maximum native accuracy/damage draws; no combat handler is replaced.
  JavaRandom.nextDouble = () => 0.999999;
  try { return fn(); } finally { JavaRandom.nextDouble = original; }
}
function pumpNpc(p, n, done, limit, label, playerCombat = false) {
  for (let tick = 0; tick < limit && !done(); tick++) {
    // The production tick clears consumed pathing steps before the next turn.
    p.resetEntity(false);
    if (n.isActive) n.resetEntity(false);
    World.currentTick++;
    World.processNpcEventQueue();
    if (n.isActive) n.turn();
    if (p.delayed && World.currentTick >= p.delayedUntil) p.delayed = false;
    if (!p.delayed && p.activeScript?.execution === ScriptState.SUSPENDED) p.executeScript(p.activeScript, true, true);
    p.processQueues();
    if (playerCombat) {
      p.processEngineQueue();
      p.processInteraction();
    }
  }
  if (!done()) assert.fail(`${label}: ${JSON.stringify({
    actor: types.NpcType.get(n.type).debugname, position: tile(n), origin: [n.startLevel, n.startX, n.startZ],
    mode: n.targetOp, target: n.target?.uid, npcHp: n.levels[NpcStat.HITPOINTS], active: n.isActive,
    player: tile(p), playerHp: p.levels[PlayerStat.HITPOINTS], event: p.getVar(v('macro_event')),
    npcScript: n.activeScript?.script.name, playerScript: p.activeScript?.script.name
  })}`);
}
function nativeAttack(p, n, weaponName = 'bronze_dagger') {
  // Own travel to a packed, reachable adjacent square; the real Attack remains the product step.
  const approach = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [n.x + dx, n.z + dz]).find(([x, z]) => {
    if (map.isMapBlocked(x, z, n.level)) return false;
    const end = map.findPath(p.level, p.x, p.z, x, z).at(-1);
    return end != null && ((end >>> 14) & 0x3fff) === x && (end & 0x3fff) === z;
  });
  assert(approach, 'packed route reaches a genuine adjacent attack square');
  [p.level, p.x, p.z] = [n.level, ...approach];
  const weapon = types.ObjType.get(obj(weaponName));
  p.invSet(id('InvType', 'worn'), weapon.id, 1, weapon.wearpos);
  run(p, '[proc,player_combat_stat]');
  p.target = n; p.targetOp = ServerTriggerType.APNPC2;
  const script = p.getOpTrigger(); assert(script, 'visible form resolves real native Attack');
  const state = ScriptRunner.init(script, p, n);
  p.executeScript(state, true, true); advance(p, state);
  assert.equal(state.execution, ScriptState.FINISHED);
}
function privateLoot(p, n) {
  return [...World.gameMap.getZone(n.x, n.z, n.level).getAllObjsSafe()]
    .filter(item => item.x === n.x && item.z === n.z && item.receiver64 === p.hash64);
}
function nativePlayerHit(p, n) {
  const hp = n.levels[NpcStat.HITPOINTS], original = JavaRandom.nextDouble;
  let draw = 0;
  // Native accuracy reads attacker, defender, then damage. All three remain valid RNG draws.
  JavaRandom.nextDouble = () => draw++ % 3 === 1 ? 0 : 0.999999;
  try {
    nativeAttack(p, n);
    pumpNpc(p, n, () => n.levels[NpcStat.HITPOINTS] < hp, 12, 'native player Attack delivers real NPC damage and heropoints');
  } finally { JavaRandom.nextDouble = original; }
}
function nativeKill(p, n) {
  nativePlayerHit(p, n);
  // Compiled lethal damage input follows a genuine player hit; no NPC HP/event state is seeded.
  n.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, n.levels[NpcStat.HITPOINTS]);
  pumpNpc(p, n, () => !n.isActive && p.getVar(v('macro_event')) === 0, 24, 'native damage and death queues release the owned encounter');
  return privateLoot(p, n);
}

function privateAdmission(p, n, event) {
  const other = player(), before = snapshot(other);
  for (const name of ['npc_is_attackable', 'npc_is_attackable_opt', 'npc_is_attackable_opt_quiet']) {
    assert.equal(run(p, `[proc,${name}]`, [], n).intStack[0], 1, `${name}: owner admitted`);
    assert.equal(run(other, `[proc,${name}]`, [], n).intStack[0], 0, `${name}: stranger refused`);
    assert.deepEqual(snapshot(other), before, `${name}: private admission stays pure and silent`);
  }
  owned(p, n, event);
}
function lootTotals(drops) {
  const result = new Map();
  for (const item of drops) result.set(item.type, (result.get(item.type) ?? 0) + item.count);
  return result;
}
// Independent native level fixtures select the six inherited bands. Statistics
// come from the retained fallback tables, not from the config being checked.
const combatForms = [
  { level: 1, hyde: [9, 9, 9, 25, 1, 1], chicken: [10, 10, 1, 19, 1, 10], hydeHit: 2, chickenHit: 1 },
  { level: 15, hyde: [22, 22, 22, 40, 1, 1], chicken: [20, 20, 1, 40, 1, 20], hydeHit: 4, chickenHit: 1 },
  { level: 25, hyde: [38, 38, 38, 60, 1, 1], chicken: [40, 40, 1, 60, 1, 40], hydeHit: 5, chickenHit: 2 },
  { level: 40, hyde: [65, 65, 65, 85, 1, 1], chicken: [60, 60, 1, 80, 1, 60], hydeHit: 7, chickenHit: 3 },
  { level: 65, hyde: [100, 100, 100, 120, 1, 1], chicken: [90, 90, 1, 105, 1, 90], hydeHit: 11, chickenHit: 4 },
  { level: 99, hyde: [130, 130, 130, 170, 1, 1], chicken: [120, 120, 1, 120, 1, 120], hydeHit: 14, chickenHit: 5 }
];
for (const [index, form] of combatForms.entries()) for (const family of ['hyde', 'chicken']) check(`${family} visible form ${index + 1} scales, damages only its owner and dies through native damage/drop queues`, () => {
  const p = player(form.level), event = family === 'hyde' ? 10 : 11, n = spawn(p, event), initialUid = n.uid;
  if (family === 'hyde') {
    pumpNpc(p, n, () => n.type !== id('NpcType', 'macro_jekyll'), 120, 'ignoring real Jekyll transforms him through his attention timer');
    assert.notEqual(n.uid, initialUid, 'visible morph republishes a new type-bearing actor token');
  }
  assert.equal(n.type, id('NpcType', `macro_${family === 'hyde' ? 'hyde' : 'evil_chicken'}_${index + 1}`));
  owned(p, n, event);
  assert.deepEqual([...n.baseLevels], form[family], 'native transformed base stats match the independent fallback/default table');
  assert.deepEqual([...n.levels], form[family], 'transformation initializes real combat health and levels');
  assert.equal(run(p, '[proc,npc_max_dealt]', [32, 0], n).intStack[0], 32, 'outgoing NPC hit limits must not cap incoming player damage');
  privateAdmission(p, n, event);
  // Own-stat fixture after selection: let the genuine NPC attack land without
  // changing its scale, replacing a combat handler, or seeding event progress.
  p.baseLevels[PlayerStat.DEFENCE] = p.levels[PlayerStat.DEFENCE] = 1;
  p.baseLevels[PlayerStat.MAGIC] = p.levels[PlayerStat.MAGIC] = 1;
  p.baseLevels[PlayerStat.HITPOINTS] = p.levels[PlayerStat.HITPOINTS] = 99;
  const hp = p.levels[PlayerStat.HITPOINTS], position = tile(n);
  combatRolls(() => pumpNpc(p, n, () => p.levels[PlayerStat.HITPOINTS] < hp, 24, 'production visible-form AI delivers real damage'));
  const damage = hp - p.levels[PlayerStat.HITPOINTS];
  assert(damage > 0 && damage <= form[`${family}Hit`], 'real hit respects its independently recorded maximum');
  if (family === 'chicken') {
    assert.deepEqual(tile(n), position, 'the original stationary chicken casts without chasing');
    const ownerPosition = tile(p), until = World.currentTick + 8;
    [p.level, p.x, p.z] = [n.level, n.x + 7, n.z]; // Own travel beyond casting reach, still inside its departure bound.
    pumpNpc(p, n, () => World.currentTick >= until, 8, 'native AI runs while its owner is outside casting reach');
    assert.deepEqual(tile(n), position, 'a chicken never walks after an out-of-casting-range owner');
    owned(p, n, event);
    [p.level, p.x, p.z] = ownerPosition;
  }
  const choice = index % 4;
  const drops = draws({ '[proc,macro_event_hyde_death]': [choice] }, () => nativeKill(p, n));
  assert(drops.every(item => item.receiver64 === p.hash64), 'native hero attribution owns every dropped object');
  const totals = lootTotals(drops);
  assert.equal(totals.get(obj('bones')), 1);
  if (family === 'hyde') {
    const expected = [obj('bones'), ...(choice < 3 ? [obj(['1dose2energy', '1dosestatrestore', '1dose1strength'][choice])] : [])];
    assert.deepEqual([...totals.keys()].sort((a, b) => a - b), expected.sort((a, b) => a - b), 'all four explicit engineering potion outcomes are reachable without extra loot');
    for (const quantity of totals.values()) assert.equal(quantity, 1);
  } else {
    assert.equal(totals.get(obj('raw_chicken')), 1); assert.equal(totals.get(obj('egg')), 1);
    const feathers = totals.get(obj('feather'));
    assert(feathers >= 50 && feathers <= 750, 'actual death produces the candidate authentic feather bounds');
    assert.equal(totals.size, 4);
  }
  assert.equal(p.getVar(v('macro_event')), 0); assert(!n.isActive);
});

check('full-health level-159 Chicken dies through repeated native whip combat without an incoming damage cap', () => {
  const p = player(), n = spawn(p, 11);
  assert.equal(n.type, id('NpcType', 'macro_evil_chicken_6'));
  assert.equal(n.levels[NpcStat.HITPOINTS], 120, 'fight starts with the complete configured health');
  combatRolls(() => {
    nativeAttack(p, n, 'abyssal_whip');
    pumpNpc(p, n, () => !n.isActive && p.getVar(v('macro_event')) === 0, 80, 'ordinary native player combat kills the full-health Chicken', true);
  });
  assert(p.levels[PlayerStat.HITPOINTS] > 0, 'the player survives ordinary native combat');
  const feathers = lootTotals(privateLoot(p, n)).get(obj('feather'));
  assert(feathers >= 50 && feathers <= 750, 'the unseeded native kill leaves private feather loot');
});
check('a stale post-death queue cannot clear a newer owned encounter', () => {
  const p = player(), old = spawn(p, 11), actor = old.uid;
  cleanup(p);
  const current = spawn(p, 13), before = snapshot(p);
  run(p, '[queue,macro_overworld_death_cleanup]', [11, actor]);
  assert.deepEqual(snapshot(p), before);
  owned(p, current, 13); assert(current.isActive);
  cleanup(p);
});
for (const family of ['hyde', 'chicken']) check(`${family} safely departs without loot when its real owner leaves the area`, () => {
  const p = player(), n = spawn(p, family === 'hyde' ? 10 : 11);
  if (family === 'hyde') pumpNpc(p, n, () => n.type !== id('NpcType', 'macro_jekyll'), 120, 'real attention timer creates Hyde');
  [p.level, p.x, p.z] = [0, 3213, 3424]; // Own travel to independently identified Varrock, not an event-state seed.
  escaped(p, 'owner travel away from hostile event');
  pumpNpc(p, n, () => !n.isActive && p.getVar(v('macro_event')) === 0, 24, 'real attention timer cleans up a distant hostile');
  assert.equal(privateLoot(p, n).length, 0, 'departure is not a kill and grants no loot');
  for (const name of ['macro_event_uid', 'macro_event_origin_coord', 'macro_event_target_coord']) assert.equal(p.getVar(v(name)), -1);
});
const periodPirateGifts = ['coins', 'uncut_sapphire', 'uncut_emerald', 'uncut_ruby', 'uncut_diamond', 'kebab', 'spinach_roll', 'keyhalf1', 'keyhalf2'];
for (const [event, rewardProc, coinAmounts] of [
  [8, 'macro_event_capn_hand_reward', [120, 160]],
  [9, 'macro_event_rick_turpentine_reward', [80, 160, 240, 320, 480, 640]]
]) check(`pirate event ${event} exhausts its period gift union and explicitly labelled fallback coin amounts`, () => {
  const seen = new Set(), coins = new Set();
  for (let category = 0; category < periodPirateGifts.length; category++) {
    for (let amount = 0; amount < (category === 0 ? coinAmounts.length : 1); amount++) {
      const p = player(), n = spawn(p, event);
      draws({ [`[proc,${rewardProc}]`]: [category, amount] }, () => talk(p, n));
      const received = inventory(p).filter(Boolean);
      assert.equal(received.length, 1, 'one complete greeting gives one actual gift');
      const gift = received[0];
      assert(periodPirateGifts.includes(gift.name), 'no modern-only gift replaces the retained period set');
      seen.add(gift.name);
      if (gift.name === 'coins') {
        assert(coinAmounts.includes(gift.count), 'coin amount is independently sourced fallback data, not one invented coin');
        coins.add(gift.count);
      } else assert.equal(gift.count, 1);
      pumpNpc(p, n, () => !n.isActive && p.getVar(v('macro_event')) === 0, 24, 'each native gift completes exactly its owned encounter');
    }
  }
  assert.deepEqual([...seen].sort(), [...periodPirateGifts].sort(), 'all period gift categories, including spinach rolls, kebabs and both key halves, are reachable');
  assert.deepEqual([...coins].sort((a, b) => a - b), coinAmounts);
});
const frogActors = new Set(['macro_frog_royal', 'macro_frog_sulking', 'macro_frog_noncombat', 'macro_frog_crier', 'macro_frog_prince', 'macro_frog_princess'].map(name => id('NpcType', name)));
function ownedFrogs(p) {
  return [...World.npcs].filter(n => n.isActive && frogActors.has(n.type) && n.getVar(nv('npc_macro_event_target')) === p.uid);
}
for (const gender of [0, 1]) check(`native royal kiss for gender ${gender} owns its crowd, visible human morph and token`, () => {
  const p = player(); p.gender = gender; const n = spawn(p, 12);
  assert.equal(n.type, id('NpcType', 'macro_frog_royal'));
  assert(ownedFrogs(p).length >= 3, 'a real private frog crowd accompanies its royal');
  const other = player(), before = snapshot(other); talk(other, n);
  assert.deepEqual(snapshot(other), before); owned(p, n, 12);
  const forms = [];
  talk(p, n, [], () => { forms.push(n.type); if (p.getVar(v('macro_event')) === 12) owned(p, n, 12); });
  assert(forms.includes(id('NpcType', gender === 0 ? 'macro_frog_princess' : 'macro_frog_prince')), 'the kissed royal visibly becomes the opposite-gender human');
  assert.equal(count(p, 'macro_frog_token'), 1); assert.equal(p.npcId, -1); assert.deepEqual(tile(p), O);
  assert.equal(p.getVar(v('macro_event')), 0); assert.equal(ownedFrogs(p).length, 0);
});
check('all six original frog token and costume objects are untradeable', () => {
  for (const name of ['macro_frog_token', 'macro_frog_mask', 'macro_prince_torso', 'macro_prince_legs', 'macro_princess_torso', 'macro_princess_legs']) {
    assert.equal(types.ObjType.get(obj(name)).tradeable, false, name);
  }
});
check('losing a Frog token has a real recovery path through another native royal kiss', () => {
  const p = player(); talk(p, spawn(p, 12)); assert.equal(count(p, 'macro_frog_token'), 1);
  held(p, 'macro_frog_token', 5); finish(p); assert.equal(count(p, 'macro_frog_token'), 0, 'native Drop actually loses the token');
  talk(p, spawn(p, 12));
  assert.equal(count(p, 'macro_frog_token'), 1); assert.equal(p.getVar(v('macro_event')), 0);
});
for (const gender of [0, 1]) for (const reward of ['mask', 'outfit']) check(`Thessalia exchanges a genuinely earned token for gender ${gender} ${reward}`, () => {
  const p = player(); p.gender = gender; talk(p, spawn(p, 12));
  const n = [...World.npcs].find(n => n.type === id('NpcType', 'thessalia')); assert(n);
  [p.level, p.x, p.z] = [n.level, n.x + 1, n.z]; // Own-position fixture: travel is not the exchange under test.
  escaped(p, 'original Varrock clothes shop');
  talk(p, n, [reward === 'mask' ? 1 : 2]);
  assert.equal(count(p, 'macro_frog_token'), 0);
  const expected = reward === 'mask' ? ['macro_frog_mask'] : gender === 0 ? ['macro_prince_torso', 'macro_prince_legs'] : ['macro_princess_torso', 'macro_princess_legs'];
  for (const name of expected) assert.equal(count(p, name), 1);
  assert.equal(p.getVar(v('macro_event')), 0);
});
check('a full inventory cannot consume a royal kiss reward; making room permits real recovery', () => {
  const p = player(); give(p, 'logs', 28); const n = spawn(p, 12);
  talk(p, n);
  assert.equal(count(p, 'macro_frog_token'), 0); assert.equal(count(p, 'logs'), 28); owned(p, n, 12);
  p.invDel(inv, obj('logs'), 1); // Own inventory setup, not encounter progress.
  talk(p, n);
  assert.equal(count(p, 'macro_frog_token'), 1); assert.equal(count(p, 'logs'), 27);
  assert.equal(p.getVar(v('macro_event')), 0);
});
check('Thessalia exchanges a full-inventory token for a mask without losing other items', () => {
  const p = player(); talk(p, spawn(p, 12)); give(p, 'logs', 27);
  const n = [...World.npcs].find(n => n.type === id('NpcType', 'thessalia')); assert(n);
  talk(p, n, [1]);
  assert.equal(count(p, 'macro_frog_token'), 0); assert.equal(count(p, 'macro_frog_mask'), 1); assert.equal(count(p, 'logs'), 27);
  assert.equal(inventory(p).filter(Boolean).length, 28);
});
check('Thessalia preserves an earned token when its two-part outfit cannot fit, then completes after room is made', () => {
  const p = player(); talk(p, spawn(p, 12)); give(p, 'logs', 27);
  const n = [...World.npcs].find(n => n.type === id('NpcType', 'thessalia')); assert(n);
  talk(p, n, [2, 2]);
  assert.equal(count(p, 'macro_frog_token'), 1); assert.equal(count(p, 'logs'), 27);
  assert.equal(count(p, 'macro_prince_torso'), 0); assert.equal(count(p, 'macro_prince_legs'), 0);
  p.invDel(inv, obj('logs'), 1); // Own inventory setup, not reward or event-state seeding.
  talk(p, n, [2]);
  assert.equal(count(p, 'macro_frog_token'), 0); assert.equal(count(p, 'logs'), 26);
  assert.equal(count(p, 'macro_prince_torso'), 1); assert.equal(count(p, 'macro_prince_legs'), 1);
  assert.equal(inventory(p).filter(Boolean).length, 28);
});
check('declining token exchange preserves its token and real holiday recovery dialogue', () => {
  const p = player(); talk(p, spawn(p, 12));
  p.setVar(v('bunny_ears_unlocked'), 1); p.setVar(v('scythe_unlocked'), 1); // Existing holiday prerequisites, not frog progress.
  const n = [...World.npcs].find(n => n.type === id('NpcType', 'thessalia')); assert(n);
  [p.level, p.x, p.z] = [n.level, n.x + 1, n.z];
  talk(p, n, [3, 4, 2]);
  assert.equal(count(p, 'macro_frog_token'), 1); assert.equal(count(p, 'bunnyears'), 1); assert.equal(count(p, 'scythe'), 0);
});
function inFrogland(p) { return p.level === 0 && p.x >= 2432 && p.x <= 2495 && p.z >= 4736 && p.z <= 4799; }
function frogCave(p, timeout) {
  const n = spawn(p, 12);
  if (timeout) pumpNpc(p, n, () => inFrogland(p), 140, 'real frog attention timer transports its ignored owner');
  else talk(p, n, [2]);
  finish(p);
  assert.deepEqual(tile(p), [0, 2467, 4771], 'landing belongs to the independently identified original Frogland region');
  escaped(p, 'original Frogland cave');
  assert.equal(p.npcId, id('NpcType', 'macro_frog_nohat'));
  assert.equal(p.getVar(v('macro_event_origin_coord')), (O[1] << 14) | O[2]);
  assert.equal(count(p, 'macro_frog_token'), 0);
  const royal = World.getNpcByUid(p.getVar(v('macro_event_uid')));
  assert(royal?.isActive); assert.equal(royal.type, id('NpcType', 'macro_frog_sulking')); owned(p, royal, 12);
  assert.deepEqual(tile(royal), [0, 2464, 4771]);
  const route = map.findPath(0, p.x, p.z, 2465, 4771), end = route.at(-1);
  assert(end != null && ((end >>> 14) & 0x3fff) === 2465 && (end & 0x3fff) === 4771, 'packed path reaches the royal approach tile');
  return royal;
}
function frogApology(p, royal, choices = []) {
  [p.level, p.x, p.z] = [royal.level, royal.x + 1, royal.z]; // Own travel along the separately proven cave approach.
  talk(p, royal, choices);
}
for (const timeout of [false, true]) check(`frog ${timeout ? 'real timeout' : 'native refusal'} transforms, permits a refused apology and returns safely after apology`, () => {
  const p = player(), royal = frogCave(p, timeout);
  frogApology(p, royal, [2]);
  assert(inFrogland(p)); assert.equal(p.npcId, id('NpcType', 'macro_frog_nohat')); owned(p, royal, 12);
  frogApology(p, royal, [1]);
  assert.deepEqual(tile(p), O); escaped(p, 'original frog departure');
  assert.equal(p.npcId, -1); assert.equal(count(p, 'macro_frog_token'), 0);
  assert.equal(p.getVar(v('macro_event')), 0); assert.equal(ownedFrogs(p).length, 0);
});
check('Frogland logout/login restores its form and departure; stale old-royal expiry cannot clear the resumed encounter', () => {
  const p = player(), old = frogCave(p, false), origin = p.getVar(v('macro_event_origin_coord'));
  run(p, '[proc,macro_event_logout]');
  assert.equal(p.getVar(v('macro_event')), 12); assert.equal(p.getVar(v('macro_event_origin_coord')), origin);
  assert.equal(old.getVar(nv('npc_macro_event_target')), -1); assert.equal(p.npcId, -1);
  run(p, '[queue,macro_event_login]');
  const resumed = World.getNpcByUid(p.getVar(v('macro_event_uid')));
  assert(resumed?.isActive); assert.notEqual(resumed.uid, old.uid); owned(p, resumed, 12);
  assert.equal(p.npcId, id('NpcType', 'macro_frog_nohat')); assert(inFrogland(p));
  assert.equal(p.getVar(v('macro_event_origin_coord')), origin);
  pumpNpc(p, old, () => !old.isActive, 130, 'the detached old royal eventually departs');
  owned(p, resumed, 12); assert.equal(p.getVar(v('macro_event_origin_coord')), origin);
  frogApology(p, resumed);
  assert.deepEqual(tile(p), O); assert.equal(p.npcId, -1); assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(count(p, 'macro_frog_token'), 0); assert.equal(ownedFrogs(p).length, 0);
});
check('actual default death inside Frogland clears only its owned cave, crowd and form before normal respawn', () => {
  const p = player(), royal = frogCave(p, false);
  p.levels[PlayerStat.HITPOINTS] = 0; // Compiled lethal input; all cave and encounter state came from native refusal.
  run(p, '[queue,player_death_default]');
  assert.equal(p.npcId, -1); assert.equal(p.getVar(v('macro_event')), 0); assert.equal(ownedFrogs(p).length, 0); assert(!royal.isActive);
  for (const name of ['macro_event_uid', 'macro_event_origin_coord', 'macro_event_target_coord']) assert.equal(p.getVar(v(name)), -1);
  assert.equal(p.level, 0); assert(Math.abs(p.x - 3221) <= 2 && Math.abs(p.z - 3218) <= 2);
  assert.equal(p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS]); escaped(p, 'ordinary post-Frogland death respawn');
  assert.equal(count(p, 'macro_frog_token'), 0);
});
for (const event of [0, 2]) check(`default death preserves published ${event ? 'Genie follower' : 'ordinary'} behavior`, () => {
  const p = player(), n = event ? spawn(p, event) : null;
  p.levels[PlayerStat.HITPOINTS] = 0; // Compiled death input; encounter state is produced only by its spawner.
  run(p, '[queue,player_death_default]');
  assert.equal(p.getVar(v('macro_event')), event);
  assert.equal(p.level, 0); assert(Math.abs(p.x - 3221) <= 2 && Math.abs(p.z - 3218) <= 2);
  escaped(p, 'ordinary Lumbridge respawn');
  assert.equal(p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS]);
  if (n) { owned(p, n, event); assert(n.isActive); cleanup(p); }
});
for (const [event, name] of [[8, "Cap'n Hand"], [9, 'Rick Turpentine']]) {
  check(`${name} native greeting is owner-only and grants a period gift without teleport`, () => {
    const p = player(), other = player(), n = spawn(p, event);
    const outsider = inventory(other); talk(other, n);
    assert.deepEqual(inventory(other), outsider); owned(p, n, event);
    assert.equal(other.getVar(v('macro_event')), 0);
    talk(p, n);
    assert(inventory(p).some(Boolean), 'real greeting grants an actual item');
    assert.deepEqual(tile(p), O, 'gift does not invent a success teleport');
    pumpNpc(p, n, () => p.getVar(v('macro_event')) === 0 && !n.isActive, 24, 'reward clears the owned encounter and departs');
  });
  check(`${name} real timeout uses crossbow damage${event === 9 ? ' and carried-coin theft' : ''}; owned cleanup clears it`, () => {
    const p = player();
    p.baseLevels[PlayerStat.DEFENCE] = p.levels[PlayerStat.DEFENCE] = 1; // Own-stat fixture lets the real crossbow hit without replacing combat.
    const n = spawn(p, event);
    if (event === 9) give(p, 'coins', 50);
    const hp = p.levels[PlayerStat.HITPOINTS];
    combatRolls(() => pumpNpc(p, n, () => p.levels[PlayerStat.HITPOINTS] < hp && (event !== 9 || count(p, 'coins') === 0), 160, 'native timed punishment deals damage and any specified theft'));
    assert.equal(p.getVar(v('macro_event')), event, 'punishment belongs to this encounter');
    cleanup(p);
    pumpNpc(p, n, () => p.getVar(v('macro_event')) === 0 && !n.isActive, 24, 'owned cleanup removes only its own pirate');
  });
}
function escaped(p, label) {
  assert(!map.isMapBlocked(p.x, p.z, p.level), `${label}: collision-clear landing ${tile(p)}`);
  const exits = Array.from({ length: 8 }, (_, i) => [[-i - 1, 0], [i + 1, 0], [0, -i - 1], [0, i + 1]]).flat().filter(([dx, dz]) => {
    if (map.isMapBlocked(p.x + dx, p.z + dz, p.level)) return false;
    const route = map.findPath(p.level, p.x, p.z, p.x + dx, p.z + dz);
    const end = route.at(-1);
    return end != null && ((end >>> 14) & 0x3fff) === p.x + dx && (end & 0x3fff) === p.z + dz;
  });
  assert(exits.length, `${label}: a real packed path leaves the landing`);
}
function failureQueue(p) {
  const queued = [...p.queue.all()].find(q => q.script.name === '[queue,macro_event_fail_teleport]');
  assert(queued, 'punishment queues real safe teleport');
  run(p, queued.script.name, queued.args);
  assert.notDeepEqual(tile(p), O);
  escaped(p, 'punishment');
  assert.equal(p.getVar(v('macro_event')), 0);
}
const snacks = ['baguette', 'triangle_sandwich', 'square_sandwich', 'roll', 'meat_pie', 'kebab', 'chocolate_bar'];
for (let chosen = 0; chosen < snacks.length; chosen++) check(`Sandwich Lady native tray chooses ${snacks[chosen]}`, () => {
  const p = player(), other = player();
  const n = draws({ '[proc,macro_sandwich_lady_spawn]': [chosen] }, () => spawn(p, 14));
  const before = snapshot(other);
  talk(other, n);
  assert.deepEqual(snapshot(other), before, 'another player cannot open or answer the private tray');
  talk(p, n);
  assert.equal(p.modalMain, id('Component', 'sandwich_tray'));
  const overwrites = p.packets.filter(packet => packet.constructor.name === 'IfSetObject');
  assert.equal(overwrites.length, 0, 'native sandwich_tray models com_i683..com_i689 must not be overwritten by if_setobject');
  assert(button(p, `sandwich_tray:com_${chosen + 1}`), 'native button handler accepts the displayed food');
  assert.equal(count(p, snacks[chosen]), 1);
  assert.equal(p.getVar(v('macro_event')), 0);
  const after = inventory(p);
  run(p, '[proc,macro_sandwich_answer]', [chosen]);
  assert.deepEqual(inventory(p), after, 'replayed answer gives no second snack');
});
for (const wrong of [true, false]) check(`Sandwich Lady ${wrong ? 'wrong food' : 'timeout'} knocks out and safely teleports`, () => {
  const p = player(); const n = spawn(p, 14);
  if (wrong) { talk(p, n); assert(button(p, `sandwich_tray:com_${(n.getVar(nv('npc_int')) + 1) % 7 + 1}`)); }
  else ai(n);
  assert.equal(inventory(p).filter(Boolean).length, 0, 'punishment grants no food');
  failureQueue(p);
});
for (const name of ['baguette', 'triangle_sandwich', 'square_sandwich', 'roll']) check(`original snack ${name} uses ordinary eating`, () => {
  const p = player(); p.levels[PlayerStat.HITPOINTS] = 50; give(p, name);
  assert(held(p, name, 1));
  assert.equal(count(p, name), 0);
  assert(p.levels[PlayerStat.HITPOINTS] > 50);
});
const brothers = ['macro_niles', 'macro_miles', 'macro_giles'];
for (let actor = 0; actor < 3; actor++) for (let answer = 0; answer < 3; answer++) check(`Certer ${brothers[actor]} native correct option ${answer}`, () => {
  const p = player(), other = player();
  const n = draws({ '[proc,macro_certers_spawn]': [actor] }, () => spawn(p, 13));
  assert.equal(n.type, id('NpcType', brothers[actor]));
  const before = snapshot(other); talk(other, n); assert.deepEqual(snapshot(other), before);
  const question = (actor * 3 + answer) % 6;
  draws({ '[proc,macro_certers_talk]': [question, answer] }, () => talk(p, n));
  assert.equal(p.modalMain, id('Component', 'inter_293'));
  const expected = ['bronze_med_helm', 'bronze_dagger', 'leather_boots', 'logs', 'gold_ring', 'lobster'][question];
  assert(p.packets.some(packet => packet.constructor.name === 'IfSetObject' && packet.component === id('Component', 'inter_293:com_7') && packet.obj === obj(expected)), 'the challenge shows the independently selected original object');
  const text = p.packets.filter(packet => packet.constructor.name === 'IfSetText' && packet.component === id('Component', `inter_293:com_${answer + 1}`)).at(-1)?.text;
  assert.equal(text, `${'ABC'[answer]}....${types.ObjType.get(obj(expected)).name}`, 'the actual displayed correct option names the displayed object');
  draws({ '[proc,macro_certers_answer]': [actor] }, () => assert(button(p, `inter_293:com_${9 + answer}`)));
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(count(p, ['coins', 'kebab', 'uncut_sapphire'][actor]), actor === 0 ? 240 : 1, 'all three sourced reward categories execute');
  const after = inventory(p); run(p, '[proc,macro_certers_answer]', [answer]);
  assert.deepEqual(inventory(p), after, 'replayed answer cannot reward twice');
});
for (const timeout of [false, true]) check(`Certer ${timeout ? 'timeout' : 'wrong answer'} notes certable slots without loss`, () => {
  const p = player(); give(p, 'logs', 2); give(p, 'bronze_dagger'); give(p, 'coins', 701); give(p, 'macro_cube');
  p.invAdd(inv, types.ObjType.get(obj('logs')).certlink, 3); // A pre-existing note stack must merge without loss or becoming unnoted.
  const n = spawn(p, 13);
  const before = p.getInventory(inv).items.map(item => item ? { ...item } : null);
  if (timeout) ai(n);
  else { talk(p, n); const correct = (n.getVar(nv('npc_int')) - 100) % 3; assert(button(p, `inter_293:com_${9 + (correct + 1) % 3}`)); }
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.deepEqual(tile(p), O, 'period punishment does not invent a teleport');
  const expected = new Map();
  for (const item of before.filter(Boolean)) {
    const config = types.ObjType.get(item.id);
    const note = config.certtemplate === -1 && config.certlink >= 0 ? config.certlink : item.id;
    expected.set(note, (expected.get(note) ?? 0) + item.count);
  }
  const actual = new Map();
  for (const item of p.getInventory(inv).items.filter(Boolean)) actual.set(item.id, (actual.get(item.id) ?? 0) + item.count);
  assert.deepEqual(actual, expected, 'native certification merges banknotes while preserving every object quantity');
});
check('old Sandwich Lady queue cannot move a newer private event', () => {
  const p = player(); const n = spawn(p, 14); ai(n);
  const q = [...p.queue.all()].find(q => q.script.name === '[queue,macro_event_fail_teleport]'); assert(q);
  const current = spawn(p, 13), before = snapshot(p);
  run(p, q.script.name, q.args);
  assert.deepEqual(snapshot(p), before);
  owned(p, current, 13); cleanup(p);
});
check('Strange Box login restores only missing timers and clears them without a box', () => {
  const p = player(); give(p, 'macro_cube');
  const startTick = World.currentTick;
  run(p, '[proc,macro_cube_login]');
  const timers = ['macro_cube_add', 'macro_cube_split'].map(name => {
    const timerId = packed(`[timer,${name}]`).id;
    const timer = p.timers.get(timerId);
    assert(timer, `${name} is restored`);
    assert.equal(timer.clock, startTick, `${name} starts at the first login tick`);
    return [timerId, timer];
  });
  World.currentTick = startTick + 5;
  run(p, '[proc,macro_cube_login]');
  for (const [timerId, timer] of timers) {
    assert.strictEqual(p.timers.get(timerId), timer, 'a present timer is not replaced or postponed');
    assert.equal(timer.clock, startTick);
  }
  p.invDel(inv, obj('macro_cube'), 1);
  run(p, '[proc,macro_cube_login]');
  for (const name of ['macro_cube_add', 'macro_cube_split']) assert(!p.timers.has(packed(`[timer,${name}]`).id));
});
check('Strange Box replicates into free slots, beyond a full inventory, and splits a stack', () => {
  const p = player(); give(p, 'macro_cube');
  run(p, '[timer,macro_cube_add]'); assert.equal(count(p, 'macro_cube'), 2);
  assert.equal(inventory(p).filter(item => item?.name === 'macro_cube').length, 2);
  for (let n = 0; n < 30; n++) run(p, '[proc,try_add_macro_cube]');
  assert.equal(count(p, 'macro_cube'), 32, 'period full-inventory cubes stack instead of silently stopping at 28');
  const q = player(); give(q, 'macro_cube', 3);
  run(q, '[timer,macro_cube_split]');
  assert.equal(count(q, 'macro_cube'), 3, 'splitting conserves all cubes');
  assert.equal(inventory(q).filter(item => item?.name === 'macro_cube').length, 2, 'a real stacked cube separates into a free slot');
});
check('Strange Box native wrong/correct answers replicate and reward only after final cube', () => {
  const p = player(); give(p, 'macro_cube');
  const open = () => draws({ '[proc,macro_cube_open]': [0, 1, 2, 1, 2, 3, 0, 2] }, () => { assert(held(p, 'macro_cube', 1)); advance(p, p.activeScript ?? { execution: ScriptState.FINISHED }); });
  open(); assert.equal(p.modalMain, id('Component', 'macro_cube'));
  assert(button(p, 'macro_cube:answer_button1')); assert.equal(count(p, 'macro_cube'), 2);
  open(); assert(button(p, 'macro_cube:answer_button3'));
  assert.equal(count(p, 'macro_cube'), 1); assert.equal(inventory(p).filter(Boolean).length, 1, 'intermediate solve gives no reward');
  open(); assert(button(p, 'macro_cube:answer_button3'));
  assert.equal(count(p, 'macro_cube'), 0); assert(inventory(p).some(Boolean), 'last solve grants one reward');
  for (const name of ['macro_cube_add', 'macro_cube_split']) assert(!p.timers.has(packed(`[timer,${name}]`).id));
  const after = inventory(p); run(p, '[proc,macro_cube_success]'); assert.deepEqual(inventory(p), after, 'replay without a cube cannot mint a reward');
});
for (const carrying of [false, true]) check(`real login ${carrying ? 'restores owned box timers' : 'removes unqualified box timers'}`, () => {
  const p = player();
  if (carrying) give(p, 'macro_cube');
  p.timers.clear();
  run(p, '[login,_]');
  for (const name of ['macro_cube_add', 'macro_cube_split']) assert.equal(p.timers.has(packed(`[timer,${name}]`).id), carrying);
  assert.equal(count(p, 'macro_cube'), carrying ? 1 : 0, 'login itself neither duplicates nor grants boxes');
});
check('original Strange Box stays private and native Drop/bank attempts replicate without losing it', () => {
  const p = player(); give(p, 'macro_cube');
  assert.equal(types.ObjType.get(obj('macro_cube')).tradeable, false);
  assert(held(p, 'macro_cube', 5)); assert.equal(count(p, 'macro_cube'), 2, 'native Drop produces another cube instead of dropping');
  const blocked = run(p, '[proc,bank_check_nobreak]', [obj('macro_cube')]);
  assert.equal(blocked.intStack[0], 1); assert.equal(count(p, 'macro_cube'), 3, 'existing bank predicate refuses and duplicates');
});
check('Thessalia without a token keeps ordinary clothing and both holiday recoveries', () => {
  const p = player(), n = [...World.npcs].find(n => n.type === id('NpcType', 'thessalia'));
  assert(n, 'original map places Thessalia');
  const before = inventory(p); talk(p, n, [2]); assert.deepEqual(inventory(p), before);
  p.setVar(v('bunny_ears_unlocked'), 1); p.setVar(v('scythe_unlocked'), 1);
  talk(p, n, [4, 2]); assert.equal(count(p, 'bunnyears'), 1); assert.equal(count(p, 'scythe'), 0);
  talk(p, n, [3, 2]); assert.equal(count(p, 'bunnyears'), 1); assert.equal(count(p, 'scythe'), 1);
});
for (const branch of [0, 1]) check(`ordinary MOM gift branch ${branch} is owner-only and completes`, () => {
  const p = player(), other = player(); const n = spawn(p, 4);
  const before = snapshot(other); talk(other, n); assert.deepEqual(snapshot(other), before);
  draws({ '[opnpc1,macro_mage]': [branch] }, () => talk(p, n));
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(count(p, 'macro_cube'), branch === 0 ? 1 : 0);
  assert(inventory(p).some(Boolean), 'ordinary gift, not debugproc, grants a reward');
});

check('Strange Box full-inventory Old Man gift cannot create an inaccessible box', () => {
  const p = player(); give(p, 'logs', 28); const n = spawn(p, 4);
  talk(p, n);
  assert.equal(count(p, 'macro_cube'), 0);
  assert.equal(p.getVar(v('macro_event')), 0);
  for (const name of ['macro_cube_add', 'macro_cube_split']) assert(!p.timers.has(packed(`[timer,${name}]`).id));
});
for (const [event, actor, gifts] of [[2, 'macro_geni', ['macro_genilamp']], [3, 'macro_dwarf', ['beer', 'kebab']]]) check(`legacy ${actor} native reward remains unchanged`, () => {
  const p = player(), n = spawn(p, event);
  assert.equal(n.type, id('NpcType', actor)); talk(p, n);
  for (const gift of gifts) assert.equal(count(p, gift), 1);
  assert.equal(p.getVar(v('macro_event')), 0);
});
check('legacy Swarm stays immediately hostile and releases general-event admission', () => {
  const p = player(); run(p, '[proc,macro_event_general_spawn]', [1]);
  const n = World.getNpcByUid(p.getVar(v('macro_event_uid')));
  assert.equal(n.type, id('NpcType', 'macro_swarm'));
  assert.equal(n.getVar(nv('npc_macro_event_target')), p.uid);
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(p.getVar(v('aggressive_npc')), n.uid);
  World.removeNpc(n, -1);
});
check('legacy Strange Plant still grows before its native fruit reward', () => {
  const p = player(), n = spawn(p, 6);
  talk(p, n); assert.equal(count(p, 'macro_triffidfruit'), 0);
  ai(n); talk(p, n);
  assert.equal(count(p, 'macro_triffidfruit'), 1);
  assert.equal(p.getVar(v('macro_event')), 0);
});
check('legacy Lost and Found keeps departure, odd appendage and intended destination', () => {
  const p = player(), destination = (3213 << 14) | 3424;
  run(p, '[proc,macro_laf_start]', [destination]); finish(p);
  assert.equal(p.getVar(v('macro_event')), 7);
  const values = [1, 2, 3, 4].map(i => p.getVarBit(id('VarBitType', `macro_laf_appendage_${i}_state`)));
  const odd = values.findIndex(value => values.filter(other => other === value).length === 1);
  assert(odd >= 0);
  run(p, '[proc,check_appendages]', [odd]);
  assert.deepEqual(tile(p), [0, 3213, 3424]);
  escaped(p, 'Lost and Found intended destination');
  assert.equal(p.getVar(v('macro_event')), 0);
});

check('ordinary Man direct, manual-magic and silent-area admission remain attackable', () => {
  const p = player(), n = [...World.npcs].find(n => n.type === id('NpcType', 'man'));
  assert(n, 'original map places an ordinary Man');
  for (const name of ['npc_is_attackable', 'npc_is_attackable_opt', 'npc_is_attackable_opt_quiet']) {
    const state = run(p, `[proc,${name}]`, [], n);
    assert.equal(state.intStack[0], 1, name);
  }
});
const commonFailureRegions = [[1, 51, 54], [1, 48, 51], [2, 46, 52], [3, 50, 54], [1, 50, 50], [0, 48, 149], [2, 51, 49], [1, 46, 50]];
const failureRegions = {
  members: [...commonFailureRegions, [1, 39, 53], [2, 42, 53], [1, 39, 48], [0, 38, 52], [0, 43, 54], [1, 40, 51], [1, 45, 53], [1, 42, 54], [0, 41, 48], [1, 41, 49], [0, 43, 50], [1, 40, 50], [2, 48, 49], [0, 50, 150], [0, 50, 53]],
  free: [...commonFailureRegions, [0, 46, 52], [0, 45, 54], [0, 50, 53], [0, 48, 53], [0, 46, 49], [1, 47, 50], [1, 46, 52], [1, 50, 50], [1, 48, 49], [0, 50, 53], [0, 51, 50], [0, 47, 54], [0, 48, 54], [2, 48, 49], [0, 50, 150], [0, 50, 53]]
};
const Environment = (await engineModule('util/Environment.ts')).default;
for (const [world, regions] of Object.entries(failureRegions)) for (let index = 0; index < regions.length; index++) check(`Sandwich punishment ${world} destination ${index} is in its intended original area and has a packed walk out`, () => {
  const enabled = Environment.NODE_MEMBERS; Environment.NODE_MEMBERS = world === 'members';
  try {
    const p = player(), n = spawn(p, 14); ai(n);
    draws({ '[queue,macro_event_fail_teleport]': [index] }, () => failureQueue(p));
    assert.deepEqual([p.level, p.x >> 6, p.z >> 6], regions[index], 'independent inherited destination region, not a value read from a new constant');
  } finally { Environment.NODE_MEMBERS = enabled; }
});

console.log(`RESULT ${failed ? 'FAIL' : 'PASS'} random-events-overworld passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
