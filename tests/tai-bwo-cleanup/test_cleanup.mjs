import assert from 'node:assert/strict';
import { fixture, get, set, home, murcaily, World, PlayerLoading, Packet, types, map, id, obj, inv, worn,
  execute, hack, count, player, PlayerStat, ScriptProvider, ScriptState, ServerTriggerType,
  engineModule, environmentTick, dispatchNpc, resumeDialogue, standAt } from './runtime.mjs';
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const ScriptPointer = (await engineModule('engine/script/ScriptPointer.ts')).default;
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const mosquitoNames = ['tbwcu_mosquito_single', 'tbwcu_mosquito_swarm3', 'tbwcu_mosquito_swarm5'];
const mosquitoIds = mosquitoNames.map(name => id('NpcType', name));
let cases = 0;
function test(name, run) { run(); cases++; console.log(`PASS ${name}`); }
const value = (name, p, args = [], target = null) => {
  const state = execute(`[proc,${name}]`, p, args, { target });
  return state.intStack[state.isp - 1];
};
function activeMosquitoes() { return [...World.npcs].filter(n => n.isActive && mosquitoIds.includes(n.type)); }
function removeMosquitoes() { for (const n of activeMosquitoes()) World.removeNpc(n, -1); World.processNpcEventQueue(); }
function reload(p) {
  const bytes = p.save(); assert(PlayerLoading.verify(new Packet(bytes)));
  const q = PlayerLoading.load(p.username, new Packet(bytes), null);
  q.pid = p.pid; q.slot = p.slot; q.uid = p.uid; q.isActive = true;
  q.messages = []; q.packets = []; q.write = packet => q.packets.push(packet);
  q.messageGame = text => q.messages.push(String(text)); q.wrappedMessageGame = q.messageGame;
  World.players[q.pid] = q; World.playerLoop.add(q.hash64, q); return q;
}
function findJungle(name) {
  const type = id('LocType', name);
  for (let x = 43 * 64; x < 45 * 64; x++) for (let z = 47 * 64; z < 49 * 64; z++) {
    const loc = World.getLoc(x, z, 0, type); if (loc) return loc;
  }
  assert.fail(`original mapped ${name} missing`);
}
function seedFor(predicate) {
  for (let seed = 0; seed < 1000000; seed++) {
    JavaRandom.setSeed(seed);
    const first = Math.floor(JavaRandom.nextDouble() * 101), second = Math.floor(JavaRandom.nextDouble() * 100);
    if (predicate(first, second)) return seed;
  }
  assert.fail('finite native RNG fixture seed not found');
}
const quietSeed = seedFor(first => first >= 7);
function claim(p, villager = murcaily) { return execute('[proc,tbw_claim_sticks]', p, [], { target: villager }); }
const supplierNames = ['sharimika', 'mamma_bufetta', 'layleen', 'karaday', 'safta_doc', 'gabooty', 'fanellaman', 'jagbakoba', 'murcaily', 'rionasta'];
const suppliers = supplierNames.map(name => {
  const n = [...World.npcs].find(n => n.baseType === id('NpcType', `tbwcu_${name}_multinpc`));
  assert(n, `original ${name} placement`); return n;
});

test('old saves omit zero activity state; village entry restores visible suppliers and a zero HUD', () => {
  const p = player(); [p.level, p.x, p.z] = home;
  const q = reload(p);
  assert.equal(get(q, 'tai_bwo_cleanup'), 0); assert.equal(get(q, 'tai_bwo_villagerchat'), 0);
  execute('[proc,tbw_cleanup_enter]', q);
  assert.equal(get(q, 'favour_percentage'), 0); assert.equal(get(q, 'villagers_visible'), 1);
  for (let bit = 0; bit < 30; bit += 3) assert.equal((get(q, 'tai_bwo_villagerchat') >>> bit) & 7, 1);
  assert.equal(q.overlay, id('Component', 'tai_bwo_favour'));
});
test('work requires Jungle Potion and an actual Murcaily introduction; all three grades retain level/tool gates', () => {
  const p = fixture();
  assert.equal(value('tbw_cleanup_can_work', p), 0);
  set(p, 'cleanup_progress', 1); set(p, 'junglepotion', 11);
  assert.equal(value('tbw_cleanup_can_work', p), 0);
  set(p, 'junglepotion', 12); assert.equal(value('tbw_cleanup_can_work', p), 1);
  for (const [grade, level, spar] of [['easy', 10, 'light'], ['med', 20, 'med'], ['hard', 35, 'dense']]) {
    const loc = findJungle(`tai_bwo_jungle_vegetation_${grade}_1`); standAt(p, loc);
    p.levels[PlayerStat.WOODCUTTING] = level - 1; hack(p, loc);
    assert.equal(count(p, `thatching_spar_${spar}`), 0);
    p.levels[PlayerStat.WOODCUTTING] = 99;
  }
  p.invDel(worn, obj('machette'), 1);
  assert.equal(value('tbw_has_machete', p), 0);
});
test('original twelve Hack dispatches advance through four sections without changing client loc fields', () => {
  const p = fixture(); set(p, 'cleanup_progress', 1);
  for (const grade of ['easy', 'med', 'hard']) for (let section = 1; section <= 4; section++) {
    const name = `tai_bwo_jungle_vegetation_${grade}_${section}`;
    const type = types.LocType.getByName(name);
    assert(ScriptProvider.getByTrigger(ServerTriggerType.OPLOC4, type.id, type.category));
    assert.equal(value('tbw_jungle_next', p, [type.id]), id('LocType', `tai_bwo_jungle_vegetation_${grade}_${section + 1}`));
  }
  const loc = findJungle('tai_bwo_jungle_vegetation_easy_1'); standAt(p, loc);
  set(p, 'eventchance', 0); JavaRandom.setSeed(quietSeed);
  const xp = p.stats[PlayerStat.WOODCUTTING]; hack(p, loc);
  assert.equal(count(p, 'thatching_spar_light'), 1);
  assert.equal(p.stats[PlayerStat.WOODCUTTING] - xp, 320);
  assert.equal(get(p, 'vill_comm_points'), 3); assert.equal(get(p, 'eventchance'), 1);
  assert(World.getLoc(loc.x, loc.z, loc.level, id('LocType', 'tai_bwo_jungle_vegetation_easy_2')));
});
test('natural event roll is counter/101, capped at seven; only the sourced 8/7/6 mosquito slots spawn', () => {
  const p = fixture(); set(p, 'cleanup_progress', 1);
  assert(!map.isMapBlocked(p.x, p.z, p.level), 'the natural Murcaily fixture tile is walkable');
  const seeds = new Map();
  for (let seed = 0; seed < 1000000 && seeds.size < 100; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * 101) !== 0) continue;
    const roll = Math.floor(JavaRandom.nextDouble() * 100); if (!seeds.has(roll)) seeds.set(roll, seed);
  }
  assert.equal(seeds.size, 100, 'cover every table entry with the native generator');
  const spawned = [0, 0, 0];
  for (let roll = 0; roll < 100; roll++) {
    set(p, 'eventchance', 7); JavaRandom.setSeed(seeds.get(roll));
    const result = value('tbw_jungle_mosquito_event', p); World.processNpcEventQueue();
    const expected = roll >= 64 && roll < 72 ? 0 : roll < 79 && roll >= 72 ? 1 : roll < 85 && roll >= 79 ? 2 : -1;
    assert.equal(result, Number(expected >= 0)); assert.equal(get(p, 'eventchance'), 0);
    const npcs = activeMosquitoes(); assert.equal(npcs.length, expected >= 0 ? 1 : 0);
    if (expected >= 0) {
      const n = npcs[0]; assert.equal(n.type, mosquitoIds[expected]); spawned[expected]++;
      assert(!map.isMapBlocked(n.x, n.z, n.level));
      const route = Array.from(map.findPath(n.level, p.x, p.z, n.x, n.z));
      assert(route.length || (p.x === n.x && p.z === n.z), 'spawn is reachable on foot');
      if (route.length) { const last = CoordGrid.unpackCoord(route.at(-1)); assert.equal(last.x, n.x); assert.equal(last.z, n.z); }
    }
    removeMosquitoes();
  }
  assert.deepEqual(spawned, [8, 7, 6]);
  for (let counter = 0; counter <= 7; counter++) {
    const seed = seedFor((first, second) => first === counter && second === 64);
    set(p, 'eventchance', counter); JavaRandom.setSeed(seed);
    assert.equal(value('tbw_jungle_mosquito_event', p), 0, 'counter boundary fails without a spawn');
    assert.equal(get(p, 'eventchance'), counter);
  }
});
test('all three actual mosquito deaths give the killer 1/3/5 obtainable proboscides, Agility and favour', () => {
  for (let index = 0; index < 3; index++) {
    const p = fixture(); set(p, 'cleanup_progress', 1); set(p, 'eventchance', 7);
    JavaRandom.setSeed(seedFor((first, second) => first === 0 && second === [64, 72, 79][index]));
    assert.equal(value('tbw_jungle_mosquito_event', p), 1); World.processNpcEventQueue();
    const n = activeMosquitoes()[0], type = types.NpcType.get(n.type);
    assert.equal(type.stats[3], [3, 9, 15][index]);
    assert.equal(type.params.get(id('ParamType', 'attackrate')), [4, 2, 2][index]);
    n.heroPoints.addHero(p.hash64, n.levels[3]);
    const state = ScriptRunner.init(ScriptProvider.getByName('[proc,npc_default_damage]'), n, p, [n.levels[3]]);
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer); n.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED);
    const drops = [], original = World.addObj, xp = p.stats[PlayerStat.AGILITY];
    World.addObj = function (item, receiver, duration) { drops.push({ type: item.type, count: item.count }); return original.call(this, item, receiver, duration); };
    try { for (let tick = 0; tick < 40 && (n.isActive || n.activeScript); tick++) { World.currentTick++; n.turn(); p.processQueues(); } }
    finally { World.addObj = original; }
    assert.equal(n.isActive, false);
    assert.deepEqual(drops.filter(item => item.type === obj('mosquito_proboscis')), [{ type: obj('mosquito_proboscis'), count: [1, 3, 5][index] }]);
    assert.equal(p.stats[PlayerStat.AGILITY] - xp, [175, 350, 750][index]);
    assert.equal(get(p, 'vill_comm_points'), 10);
    removeMosquitoes();
  }
});
test('payout requires repair and Murcaily first; three suppliers convert all favour at one stick per tenth', () => {
  const p = fixture(); set(p, 'cleanup_progress', 1); execute('[proc,tbw_add_favour]', p, [1000]);
  claim(p); assert.equal(count(p, 'village_trade_sticks'), 0);
  set(p, 'cleanup_progress', 2); claim(p, suppliers[0]); assert.equal(count(p, 'village_trade_sticks'), 0);
  for (const [n, expected, remainder] of [[murcaily, 334, 666], [suppliers[0], 668, 332], [suppliers[1], 1000, 0]]) {
    claim(p, n); assert.equal(count(p, 'village_trade_sticks'), expected); assert.equal(get(p, 'vill_comm_points'), remainder);
    claim(p, n); assert.equal(count(p, 'village_trade_sticks'), expected, 'no repeat payment');
  }
  claim(p, suppliers[2]); assert.equal(count(p, 'village_trade_sticks'), 1000);
  assert.equal(get(p, 'favour_percentage'), 0); assert.equal(get(p, 'cleanup_progress'), 3);
});
test('worn village clothing raises the converted fraction, not its rate; unworn clothes do not', () => {
  const p = fixture(); set(p, 'cleanup_progress', 2); execute('[proc,tbw_add_favour]', p, [900]);
  p.invAdd(worn, obj('tbw_villager_hat_blue'), 1); claim(p);
  assert.equal(count(p, 'village_trade_sticks'), 330); assert.equal(get(p, 'vill_comm_points'), 570);
  const q = fixture(); set(q, 'cleanup_progress', 2); execute('[proc,tbw_add_favour]', q, [900]);
  q.invAdd(inv, obj('tbw_villager_hat_blue'), 1); claim(q); assert.equal(count(q, 'village_trade_sticks'), 300);
});
test('earned favour and supplier state survive save/load without decay; cooldown needs six 300-tick stages', () => {
  const p = fixture(); set(p, 'cleanup_progress', 2); execute('[proc,tbw_add_favour]', p, [900]); claim(p);
  set(p, 'eventchance', 7); const q = reload(p);
  assert.equal(get(q, 'vill_comm_points'), 600); assert.equal(get(q, 'chat_murc'), 7); assert.equal(get(q, 'eventchance'), 0);
  execute('[proc,tbw_cleanup_login]', q); assert.equal(get(q, 'favour_percentage'), 60);
  for (let ticks = 1; ticks <= 1800; ticks++) {
    environmentTick(q);
    assert.equal(get(q, 'vill_comm_points'), 600, 'time does not consume favour');
    assert.equal(get(q, 'chat_murc'), 7 - Math.floor(ticks / 300));
  }
  assert.equal(get(q, 'chat_murc'), 1); claim(q); assert.equal(get(q, 'chat_murc'), 7);
});
test('both visible supplier forms dispatch, and the existing Gabooty shop branches remain available', () => {
  const p = fixture(); set(p, 'cleanup_progress', 3);
  for (let i = 0; i < suppliers.length; i++) for (const stage of [1, 7]) {
    p.setVar(id('VarPlayerType', 'tai_bwo_villagerchat'), (get(p, 'tai_bwo_villagerchat') & ~(7 << (3 * i))) | (stage << (3 * i)));
    dispatchNpc(p, suppliers[i]); assert.equal(p.activeScript?.execution, ScriptState.PAUSEBUTTON);
    p.closeModal(); p.activeScript = null;
  }
  const gabooty = suppliers[5];
  for (const option of [3, 4]) { dispatchNpc(p, gabooty, option); assert.equal(p.modalMain, id('Component', 'shop_template')); p.closeModal(); }
});
test('the real Murcaily choice writes introduction only after the complete explanation', () => {
  const p = fixture();
  const state = dispatchNpc(p, murcaily);
  for (let pages = 0; !/^multi4$/.test(types.Component.get(p.modalChat).comName); pages++) {
    assert(pages < 10); assert.equal(get(p, 'cleanup_progress'), 0); resumeDialogue(p);
  }
  resumeDialogue(p, 2);
  for (let pages = 0; state.execution !== ScriptState.FINISHED; pages++) {
    assert(pages < 20); assert.equal(get(p, 'cleanup_progress'), 0); resumeDialogue(p);
  }
  assert.equal(get(p, 'cleanup_progress'), 1);
});
test('history-checked cut charts apply to each wielded machete and all three grades', () => {
  const p = fixture();
  const charts = [
    [10, [[49, 169], [54, 174], [70, 190], [85, 205]]],
    [20, [[34, 85], [39, 90], [54, 105], [70, 121]]],
    [35, [[16, 44], [21, 49], [36, 64], [52, 80]]]
  ];
  const tools = ['machette', 'machette_opal', 'machette_jade', 'machette_redtopaz'];
  for (const [requirement, chances] of charts) for (let i = 0; i < tools.length; i++) {
    p.getInventory(worn).removeAll(); p.invAdd(worn, obj(tools[i]), 1);
    const state = execute('[proc,tbw_jungle_cut_chance]', p, [requirement]);
    assert.deepEqual(Array.from(state.intStack.slice(state.isp - 2, state.isp)), chances[i]);
  }
});
test('a naturally failed hack grants one XP and caps the persistent attempt counter at seven', () => {
  const p = fixture(); set(p, 'cleanup_progress', 1); set(p, 'eventchance', 7);
  const loc = findJungle('tai_bwo_jungle_vegetation_easy_1'); standAt(p, loc);
  let seed = 0;
  for (; seed < 1000000; seed++) {
    JavaRandom.setSeed(seed);
    const rolls = [JavaRandom.nextDouble(), JavaRandom.nextDouble(), JavaRandom.nextDouble()];
    if (rolls.every(roll => Math.floor(roll * 101) >= 7) && Math.floor(JavaRandom.nextDouble() * 256) === 255) break;
  }
  assert(seed < 1000000, 'finite native failure RNG seed');
  const xp = p.stats[PlayerStat.WOODCUTTING], stage = loc.type;
  JavaRandom.setSeed(seed); hack(p, loc);
  assert.equal(loc.type, stage); assert.equal(count(p, 'thatching_spar_light'), 0);
  assert.equal(p.stats[PlayerStat.WOODCUTTING] - xp, 10); assert.equal(get(p, 'eventchance'), 7);
});
test('repellent is reusable, halves all combat stats to a floor of one and pauses every mosquito form', () => {
  for (let index = 0; index < 3; index++) {
    const p = fixture(); set(p, 'eventchance', 7); p.invAdd(inv, obj('insect_repellent'), 1);
    JavaRandom.setSeed(seedFor((first, second) => first === 0 && second === [64, 72, 79][index]));
    value('tbw_jungle_mosquito_event', p); World.processNpcEventQueue();
    const n = activeMosquitoes()[0], affected = [0, 1, 2, 4, 5], before = affected.map(stat => n.levels[stat]);
    const script = ScriptProvider.getByTrigger(ServerTriggerType.OPNPCU, n.type, types.NpcType.get(n.type).category);
    p.lastUseItem = obj('insect_repellent'); execute(script.name, p, [], { target: n });
    assert.deepEqual(affected.map(stat => n.levels[stat]), before.map(level => Math.max(1, Math.floor(level / 2))));
    assert.equal(count(p, 'insect_repellent'), 1);
    assert.equal(n.getVar(id('VarNpcType', 'npc_action_delay')), World.currentTick + 10);
    const after = n.levels.slice(); p.lastUseItem = obj('machette'); execute(script.name, p, [], { target: n });
    assert.deepEqual(n.levels, after, 'unrelated use does not weaken the mosquito');
    removeMosquitoes();
  }
});
test('supplier inventory failure is atomic and new work starts a new fractional conversion batch', () => {
  const p = fixture(); set(p, 'cleanup_progress', 2); execute('[proc,tbw_add_favour]', p, [900]);
  for (let slot = 0; slot < types.InvType.get(inv).size; slot++) p.invAdd(inv, obj('thatching_spar_light'), 1);
  claim(p); assert.equal(get(p, 'vill_comm_points'), 900); assert.equal(get(p, 'chat_murc'), 1);
  assert.equal(get(p, 'cleanup_progress'), 2); assert.equal(count(p, 'village_trade_sticks'), 0);
  p.invDel(inv, obj('thatching_spar_light'), 1); claim(p);
  assert.equal(count(p, 'village_trade_sticks'), 300); assert.equal(get(p, 'vill_comm_points'), 600);
  execute('[proc,tbw_add_favour]', p, [3]); assert.equal(get(p, 'vill_comm_max'), 0);
  claim(p, suppliers[0]); assert.equal(count(p, 'village_trade_sticks'), 501); assert.equal(get(p, 'vill_comm_points'), 402);
});
console.log(`Tai Bwo Cleanup: ${cases} compiled cases passed`);
process.exit(0);
