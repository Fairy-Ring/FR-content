// Rat Pits runtime coverage uses compiled scripts, actual venue NPCs and packed collision only.
import assert from 'node:assert/strict';
import {
  World, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType as T,
  types, map, nativeNpcRows, nativeLocRows, id, obj, inv, worn, bank, v, b,
  player, run, button, target, interact, cat, add, tile, load
} from '../ratcatchers/runtime.mjs';
const { CoordGrid } = await load('engine/CoordGrid.ts');
const { NpcStat } = await load('engine/entity/NpcStat.ts');
const { NpcMode } = await load('engine/entity/NpcMode.ts');
const JavaRandom = (await load('util/JavaRandom.ts')).default;
const purse = id('InvType', 'ratpits_purse');
const stageVar = b('ratcatch_var');
const completeStage = 127;
const npcVar = name => id('VarNpcType', name);
const value = (p, name, args = [], targetNpc = null) => run(p, `[proc,${name}]`, args, targetNpc).popInt();
const npcValue = (npc, name) => npc.getVar(npcVar(name));
const putNpcValue = (npc, name, amount) => npc.setVar(npcVar(name), amount);

const venues = [
  {
    id: 1, mx: 41, mz: 150, host: 'vc_gambler_rich1', lobby: [2660, 9622],
    cat: 'kittenpet1', owner: [[2651, 9632], [2653, 9632]],
    cats: [[2651, 9636], [2653, 9640]], rats: [[2651, 9637], [2653, 9641]],
    wallTypes: ['vc_rat_wall1', 'vc_rat_wall2', 'vc_rat_wall1_inactive', 'vc_rat_wall2_inactive']
  },
  {
    id: 2, mx: 45, mz: 79, host: 'vc_gambler_rich3', lobby: [2909, 5076],
    cat: 'growncat', owner: [[2906, 5079], [2910, 5079]],
    cats: [[2906, 5083], [2910, 5089]], rats: [[2906, 5084], [2910, 5088]],
    wallTypes: ['vc_rat_wall1', 'vc_rat_wall2', 'vc_rat_wall1_inactive', 'vc_rat_wall2_inactive']
  },
  {
    id: 3, mx: 30, mz: 73, host: 'vc_dwarf_rich1', lobby: [1938, 4689],
    cat: 'overgrowncat', owner: [[1950, 4700], [1956, 4697]],
    cats: [[1950, 4704], [1956, 4704]], rats: [[1950, 4705], [1956, 4705]],
    wallTypes: ['vc_dwarfrat_wall1', 'vc_dwarfrat_wall2', 'vc_dwarfrat_wall1_inactive', 'vc_dwarfrat_wall2_inactive']
  },
  {
    id: 4, mx: 46, mz: 150, host: 'vc_gambler_rich3', lobby: [2984, 9656],
    cat: 'wileycat', owner: [[2989, 9628], [2989, 9629]],
    cats: [[2985, 9633], [2989, 9638]], rats: [[2985, 9634], [2989, 9639]],
    wallTypes: ['vc_rat_wall1', 'vc_rat_wall2', 'vc_rat_wall1_inactive', 'vc_rat_wall2_inactive']
  }
];

function hostFor(venue) {
  const spec = venues.find(row => row.id === venue);
  const type = id('NpcType', spec.host);
  const matches = [...World.npcs].filter(npc => npc.type === type && npc.level === 0 &&
    npc.x === spec.lobby[0] && npc.z === spec.lobby[1]);
  assert.equal(matches.length, 1, `${spec.host} is the single original controller at its lobby`);
  return matches[0];
}

function sessionHost(p) {
  const uid = p.getVar(v('varp283_unused')) >>> 0;
  assert.notEqual(uid, 0xffffffff, 'the logged-in player has the typed null sentinel initialized');
  const host = World.npcs.get(uid & 0xffff);
  assert(host && host.uid === uid, 'the player token resolves to its already mapped native host');
  return host;
}

function makeTrainer(venue, { catType = venues.find(row => row.id === venue).cat, coins = 100, catspeak = false } = {}) {
  const spec = venues.find(row => row.id === venue);
  const p = player({ cat: catType });
  p.setVarBit(stageVar, completeStage);
  run(p, '[proc,ratpits_login]');
  p.teleport(spec.lobby[0], spec.lobby[1], 0);
  if (coins) add(p, 'coins', coins);
  if (catspeak) add(p, 'ics_little_amulet_of_catspeak', 1, worn);
  return p;
}

function challenge(a, b, choices = []) {
  return run(a, '[opplayer1,_]', [], b, choices);
}

function openOffer(a, b, choicesA = [], choicesB = []) {
  challenge(a, b, choicesA);
  const host = sessionHost(a);
  assert.equal(npcValue(host, 'ratpits_phase'), 1, 'the first native player challenge creates an offer');
  challenge(b, a, choicesB);
  assert.equal(sessionHost(b).uid, host.uid, 'the opponent resolves the same native controller');
  assert.equal(npcValue(host, 'ratpits_phase'), 1);
  return host;
}

function coinTotal(...players) {
  return players.reduce((sum, p) => sum + p.invTotal(inv, obj('coins')) +
    p.invTotal(bank, obj('coins')) + p.invTotal(purse, obj('coins')), 0);
}

function startMatch(a, b, host) {
  const coinsBefore = coinTotal(a, b);
  button(a, 'players_cat:com_6');
  assert.equal(npcValue(host, 'ratpits_accept_a'), 1, 'A acceptance is recorded without debiting');
  button(b, 'players_cat:com_6');
  assert.equal(npcValue(host, 'ratpits_accept_b'), 1, 'B acceptance is recorded without debiting');
  assert.equal(coinTotal(a, b), coinsBefore, 'accepted wagers remain untouched before host lock-in');
  tickHost(host);
  assert.equal(npcValue(host, 'ratpits_phase'), 2, 'the native controller atomically starts the race');
  assert.equal(a.invTotal(purse, obj('coins')), 100);
  assert.equal(b.invTotal(purse, obj('coins')), 100);
  assert.equal(coinTotal(a, b), coinsBefore, 'both equal stakes are escrowed without loss');
}

function finishNpc(npc, state, label) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 80; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} does not abort`);
    assert([ScriptState.NPC_SUSPENDED, ScriptState.SUSPENDED, ScriptState.RUNNING].includes(state.execution),
      `${label} has a supported continuation state`);
    World.currentTick++;
    npc.delayed = false;
    npc.executeScript(state);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${label} completes`);
}

function runNpcProc(npc, name) {
  const script = ScriptProvider.getByName(`[proc,${name}]`);
  assert(script, `compiled NPC proc ${name} exists`);
  const state = ScriptRunner.init(script, npc, null, []);
  npc.executeScript(state);
  finishNpc(npc, state, name);
  return state;
}

function tickHost(host) {
  World.currentTick++;
  const type = types.NpcType.get(host.type);
  const script = ScriptProvider.getByTrigger(T.AI_TIMER, type.id, type.category);
  assert(script, `${type.debugname} has its packed AI_TIMER controller`);
  const state = ScriptRunner.init(script, host, null, []);
  host.executeScript(state);
  finishNpc(host, state, `${type.debugname} AI_TIMER`);
}

function npcByUid(uid) {
  const found = [...World.npcs].find(npc => npc.uid === (uid >>> 0));
  assert(found, `NPC UID ${uid} names a real world actor`);
  return found;
}

function withRandomSequence(values, fn) {
  const previous = JavaRandom.nextDouble;
  let index = 0;
  JavaRandom.nextDouble = () => values[index++ % values.length];
  try { return fn(); }
  finally { JavaRandom.nextDouble = previous; }
}

function fillInventory(p, inventory) {
  while (p.invFreeSpace(inventory) > 0) {
    const free = p.invFreeSpace(inventory);
    p.invAdd(inventory, obj('bronze_dagger'), 1);
    assert(p.invFreeSpace(inventory) < free, 'a real non-stackable item fills each remaining slot');
  }
}

function fillBank(p) {
  for (const id of types.ObjType.configNames.values()) {
    if (p.invFreeSpace(bank) === 0) return;
    const type = types.ObjType.get(id);
    if (!type.tradeable || type.certtemplate !== -1 || id === obj('coins') || p.invTotal(bank, id) > 0) continue;
    const free = p.invFreeSpace(bank);
    p.invAdd(bank, id, 1);
    assert(p.invFreeSpace(bank) < free, 'each distinct obtainable item occupies a native bank slot');
  }
  assert.fail('the native catalogue has too few distinct bankable items for this fixture');
}

function setGrowth(p, value) { p.setVar(v('cat_growth'), value | 0); }
function growth(p) { return p.getVar(v('cat_growth')) >>> 0; }
function getRat(host, side) { return npcByUid(npcValue(host, side === 1 ? 'ratpits_rat_a' : 'ratpits_rat_b')); }
function setHp(npc, amount) { npc.levels[NpcStat.HITPOINTS] = amount; }
function moveToLobby(p, venue) {
  const spec = venues.find(row => row.id === venue);
  p.teleport(spec.lobby[0], spec.lobby[1], 0);
}

// Original host, lobby, gate, wall and race coordinates remain bound to all four 377 maps.
for (const spec of venues) {
  const hostRows = nativeNpcRows(spec.host).filter(row => row.level === 0 && row.x === spec.lobby[0] && row.z === spec.lobby[1]);
  assert.equal(hostRows.length, 1, `${spec.host} has one exact original map placement`);
  const host = hostFor(spec.id);
  assert.equal(host.type, id('NpcType', spec.host));
  assert.equal(value(makeTrainer(spec.id, { coins: 0 }), 'ratpits_venue', [host.coord]), spec.id,
    `${spec.host} is inside venue ${spec.id}`);

  const probe = makeTrainer(spec.id, { coins: 0 });
  assert.equal(value(probe, 'ratpits_host', [spec.id]), id('NpcType', spec.host));
  assert.equal(value(probe, 'ratpits_lobby', [spec.id]), CoordGrid.packCoord(0, ...spec.lobby));
  assert.equal(value(probe, 'ratpits_min_stake', [spec.id]), 100);
  assert.equal(value(probe, 'ratpits_max_stake', [spec.id]), 50000);
  assert.equal(value(probe, 'ratpits_target', [spec.id]), 5);
  assert.equal(value(probe, 'ratpits_venue', [probe.coord]), spec.id);

  const ownerTiles = [], catTiles = [], ratTiles = [];
  for (let side = 1; side <= 2; side++) {
    const owner = spec.owner[side - 1], catTile = spec.cats[side - 1], ratTile = spec.rats[side - 1];
    assert.equal(value(probe, 'ratpits_owner_tile', [spec.id, side]), CoordGrid.packCoord(0, ...owner));
    assert.equal(value(probe, 'ratpits_cat_tile', [spec.id, side]), CoordGrid.packCoord(0, ...catTile));
    assert.equal(value(probe, 'ratpits_rat_tile', [spec.id, side]), CoordGrid.packCoord(0, ...ratTile));
    for (const [label, [x, z]] of [['owner', owner], ['cat', catTile], ['rat', ratTile]]) {
      assert.equal(map.isMapBlocked(x, z, 0), false, `${spec.id} ${label} tile ${x},${z} is not collision-blocked`);
    }
    assert(map.findPath(0, catTile[0], catTile[1], ratTile[0], ratTile[1]).length,
      `${spec.id} side ${side} has an original walk path from cat to rat`);
    const hostSize = types.NpcType.get(host.type).size;
    assert(map.findPathToEntity(0, owner[0], owner[1], spec.lobby[0], spec.lobby[1], 1, hostSize, hostSize).length,
      `${spec.id} side ${side} has a native route from its outside stand to the host`);
    ownerTiles.push(owner); catTiles.push(catTile); ratTiles.push(ratTile);
  }
  const wallRows = spec.wallTypes.flatMap(name => nativeLocRows(name).filter(row => row.mx === spec.mx && row.mz === spec.mz));
  assert(wallRows.length >= 2, `${spec.id} has original native wall segments in its arena map`);

  const catType = id('NpcType', `pitrat_${['ardougne', 'varrock', 'keldagrim', 'sarim'][spec.id - 1]}_neu`);
  assert.equal(value(probe, 'ratpits_rat_type', [spec.id, 0]), catType, `${spec.id} spawns its original neutral pit rat`);
  assert(types.NpcType.get(catType), `${spec.id} neutral pit rat is a packed NPC type`);
}

// Quest and real follower ownership/stage gates include the classifier-only hellcat identities.
const categories = ['kitten', 'cat', 'overgrown', 'ratcatch_wilycat'].map(name => id('CategoryType', name));
for (let i = 0; i < venues.length; i++) {
  const spec = venues[i];
  const p = makeTrainer(spec.id, { catType: spec.cat, coins: 0 });
  assert.equal(value(p, 'ratpits_eligible', [spec.id]), 1, `venue ${spec.id} admits its owned qualifying cat`);
  assert.equal(value(p, 'ratpits_stage_allowed', [spec.id, categories[i]]), 1);
  assert.equal(value(p, 'ratpits_cat_stage', [p.getVar(v('follower_obj'))]), spec.id);
  assert.equal(value(p, 'ratpits_stage_allowed', [spec.id, categories[(i + 1) % categories.length]]), 0);
  p.setVarBit(stageVar, completeStage - 1);
  assert.equal(value(p, 'ratpits_eligible', [spec.id]), 0, `venue ${spec.id} rejects incomplete Rat Catchers`);
  p.setVarBit(stageVar, completeStage);
  const wrongStage = makeTrainer(spec.id, { catType: venues[(i + 1) % venues.length].cat, coins: 0 });
  assert.equal(value(wrongStage, 'ratpits_eligible', [spec.id]), 0, `venue ${spec.id} rejects another real cat stage`);
}
{
  const p = makeTrainer(1, { catType: null, coins: 0 });
  assert.equal(value(p, 'ratpits_eligible', [1]), 0, 'a quest-complete player without a follower is refused');
  p.setVarBit(stageVar, 0);
  assert.equal(value(p, 'ratpits_eligible', [1]), 0, 'Rat Catchers completion is required');
}
{
  const p = makeTrainer(1, { catType: 'wileycat', coins: 0 });
  assert.equal(value(p, 'ratpits_eligible', [1]), 0, 'a wrong growth stage cannot enter the kitten pit');
  cat(p).setVar(npcVar('npc_attacking_uid'), p.uid + 1);
  assert.equal(value(p, 'ratpits_eligible', [1]), 0, 'a non-owner follower cannot enter');
}
for (const [name, expected] of [
  ['kittenobject_hell', 1], ['growncatobject_hell', 2], ['overgrowncatobject_hell', 3],
  ['wileycatobject_hell', 4], ['lazycatobject_hell', 0]
]) assert.equal(value(makeTrainer(1, { coins: 0 }), 'ratpits_cat_stage', [obj(name)]), expected,
  `${name} follows the five native hellcat identities without new follower links`);

for (const [venue, names] of [
  [1, ['kittenpet1', 'kittenpet_light', 'kittenpet_brown', 'kittenpet_black', 'kittenpet_browngrey', 'kittenpet_bluegrey']],
  [2, ['growncat', 'growncat_light', 'growncat_brown', 'growncat_black', 'growncat_browngrey', 'growncat_bluegrey']],
  [3, ['overgrowncat', 'overgrowncat_light', 'overgrowncat_brown', 'overgrowncat_black', 'overgrowncat_browngrey', 'overgrowncat_bluegrey']],
  [4, ['wileycat', 'wileycat_light', 'wileycat_brown', 'wileycat_black', 'wileycat_browngrey', 'wileycat_bluegrey']]
]) for (const name of names) {
  const p = makeTrainer(venue, { catType: name, coins: 0 });
  assert.equal(value(p, 'ratpits_eligible', [venue]), 1, `${name} is an eligible real following variant`);
}
for (const name of ['lazycat', 'lazycat_light', 'lazycat_brown', 'lazycat_black', 'lazycat_browngrey', 'lazycat_bluegrey']) {
  const p = makeTrainer(4, { catType: name, coins: 0 });
  assert.equal(value(p, 'ratpits_eligible', [4]), 0, `${name} is refused at the wily-cat pit`);
}

// The pure reward preserves RFD's high bits and never steps through equality-triggered growth thresholds.
{
  const p = makeTrainer(1, { coins: 0 });
  const high = 0x78000000;
  const kittenState = (high | (119 << 11) | (95 << 20) | (1 << 5) | 7) >>> 0;
  const kittenAfter = value(p, 'ratpits_growth_reward', [kittenState, obj('kittenobject'), 12]) >>> 0;
  assert.equal(kittenAfter, (high | (119 << 11) | (100 << 20) | 7) >>> 0,
    'kitten growth clamps at 119, activity at 100, attention falls by one, and bits 27..30 survive');
  const catState = (high | (319 << 11) | (98 << 20) | (1 << 5) | 9) >>> 0;
  const catAfter = value(p, 'ratpits_growth_reward', [catState, obj('growncatobject'), 9]) >>> 0;
  assert.equal(catAfter, (high | (319 << 11) | (100 << 20) | (1 << 5) | 9) >>> 0,
    'grown-cat growth clamps below 320 and unrelated state remains unchanged');
}

// A player challenge cannot pair across native venues.
{
  const a = makeTrainer(1, { catType: 'kittenpet1', coins: 100 });
  const b = makeTrainer(2, { catType: 'growncat', coins: 100 });
  challenge(a, b);
  assert.equal(npcValue(hostFor(1), 'ratpits_phase'), 0);
  assert.equal(npcValue(hostFor(2), 'ratpits_phase'), 0);
  assert.equal(a.getVar(v('varp283_unused')), -1);
  assert.equal(b.getVar(v('varp283_unused')), -1);
  assert.equal(coinTotal(a, b), 200, 'cross-venue refusal leaves both balances unchanged');
}

// Mutual acceptance still has no debit until the offer deadline's native host cycle refunds it.
{
  const a = makeTrainer(4, { coins: 100 });
  const b = makeTrainer(4, { coins: 100 });
  const host = openOffer(a, b);
  button(a, 'players_cat:com_6');
  button(b, 'players_cat:com_6');
  assert.equal(coinTotal(a, b), 200);
  assert.equal(a.invTotal(purse, obj('coins')) + b.invTotal(purse, obj('coins')), 0);
  putNpcValue(host, 'ratpits_deadline', World.currentTick);
  tickHost(host);
  assert.equal(npcValue(host, 'ratpits_phase'), 0, 'an expired offer clears before lock-in');
  assert.equal(a.invTotal(inv, obj('coins')), 100);
  assert.equal(b.invTotal(inv, obj('coins')), 100);
  assert.equal(coinTotal(a, b), 200, 'offer timeout does not debit or duplicate either stake');
}

// Native offer controls enforce the full 100..50,000 equal-wager range before any debit.
{
  const a = makeTrainer(1, { coins: 50000 });
  const b = makeTrainer(1, { coins: 100 });
  const host = openOffer(a, b);
  assert.equal(npcValue(host, 'ratpits_stake'), 100);
  run(a, '[proc,ratpits_wager]', [-1], host);
  assert.equal(npcValue(host, 'ratpits_stake'), 100, 'the minimum cannot be underbid');
  for (let i = 0; i < 499; i++) run(a, '[proc,ratpits_wager]', [1], host);
  assert.equal(npcValue(host, 'ratpits_stake'), 50000, 'increments stop at the source-backed 50,000 cap');
  button(a, 'players_cat:com_20');
  assert.equal(npcValue(host, 'ratpits_stake'), 50000, 'the real increment button cannot exceed the cap');
  button(a, 'players_cat:com_6');
  button(b, 'players_cat:com_6');
  assert.equal(npcValue(host, 'ratpits_accept_a'), 1);
  assert.equal(npcValue(host, 'ratpits_accept_b'), 0, 'an underfunded opponent cannot accept');
  assert.equal(a.invTotal(purse, obj('coins')), 0);
  assert.equal(b.invTotal(purse, obj('coins')), 0);
  button(b, 'players_cat:com_7');
  tickHost(host);
  assert.equal(npcValue(host, 'ratpits_phase'), 0, 'pre-lock cancellation clears the offer');
  assert.equal(coinTotal(a, b), 50100, 'refusal and cancellation do not change either balance');
}

// The native Port Sarim host starts genuine cats and rats; A wins the five-rat race.
let winA = makeTrainer(4, { catType: 'wileycat', coins: 100, catspeak: true });
let winB = makeTrainer(4, { catType: 'wileycat', coins: 100 });
const winHost = openOffer(winA, winB, [4]);
assert.equal(npcValue(winHost, 'ratpits_style_a'), 4, 'worn Catspeak chooses the tactic before bidding');
assert.equal(npcValue(winHost, 'ratpits_style_b'), 0, 'without Catspeak the default is fight to death');
const winGrowthA = (0x78000000 | (15 << 11) | (10 << 20) | 3) >>> 0;
const winGrowthB = (0x78000000 | (22 << 11) | (30 << 20) | 5) >>> 0;
setGrowth(winA, winGrowthA); setGrowth(winB, winGrowthB);
startMatch(winA, winB, winHost);
const winCatA = npcByUid(npcValue(winHost, 'ratpits_cat_a'));
const winCatB = npcByUid(npcValue(winHost, 'ratpits_cat_b'));
assert.deepEqual(tile(winA), [0, ...venues[3].owner[0]], 'A is placed on the native outside-wall floor');
assert.deepEqual(tile(winCatA), [0, ...venues[3].cats[0]], 'A cat enters the actual cage');
assert.deepEqual(tile(getRat(winHost, 1)), [0, ...venues[3].rats[0]], 'A faces a real rat on the native tile');
assert.equal(getRat(winHost, 1).type, id('NpcType', 'pitrat_sarim_agr'));
assert.equal(getRat(winHost, 2).type, id('NpcType', 'pitrat_sarim_neu'));
run(winA, '[proc,ratpits_tactic]', [1], winHost);
assert.equal(npcValue(winHost, 'ratpits_style_a'), 4, 'tactics cannot be changed after the race begins');
fillInventory(winA, inv);
const winningRounds = [0.999, 0, 0.999, 0, 0.999, 0, 0.999];
for (let round = 0; round < 8 && npcValue(winHost, 'ratpits_phase') === 2; round++) {
  setHp(getRat(winHost, 1), 1);
  setHp(getRat(winHost, 2), 10000);
  withRandomSequence(winningRounds, () => tickHost(winHost));
}
assert.equal(npcValue(winHost, 'ratpits_score_a'), 5, 'the actual cat action wins five rat rounds');
assert.equal(npcValue(winHost, 'ratpits_phase'), 0);
assert.equal(winA.invTotal(inv, obj('coins')), 0);
assert.equal(winA.invTotal(bank, obj('coins')), 200, 'a full inventory falls back to bank for the whole pot');
assert.equal(winB.invTotal(inv, obj('coins')), 0);
assert.equal(coinTotal(winA, winB), 200, 'the pot is transferred exactly once');
assert.equal((growth(winA) >>> 27) & 15, 15, 'the winner preserves RFD flag bits 27..30');
assert.equal((growth(winA) >>> 11) & 511, 16, 'the winning cat receives growth');
assert.equal((growth(winA) >>> 20) & 127, 15, 'the winner gains activity for five kills');
assert.equal((growth(winB) >>> 27) & 15, 15, 'the surviving loser also preserves RFD flag bits');
assert.equal((growth(winB) >>> 11) & 511, 23, 'a surviving loss receives the approved training benefit');
assert.equal((growth(winB) >>> 20) & 127, 30, 'a surviving loss adds no rat kills');
runNpcProc(winHost, 'ratpits_finish');
run(winA, '[proc,ratpits_claim]');
run(winA, '[proc,ratpits_claim]');
assert.equal(winA.invTotal(bank, obj('coins')), 200, 'repeated finish and claim are idempotent');

// Immediate same-player rematch is available after settlement, then can be cancelled before escrow.
winA.invDel(inv, obj('bronze_dagger'), 1);
winA.invDel(bank, obj('coins'), 200);
add(winA, 'coins', 100);
add(winB, 'coins', 100);
moveToLobby(winA, 4); moveToLobby(winB, 4);
const repeatHost = openOffer(winA, winB, [1]);
assert.equal(npcValue(repeatHost, 'ratpits_phase'), 1, 'the same pair can immediately challenge again');
button(winA, 'players_cat:com_7');
tickHost(repeatHost);
assert.equal(npcValue(repeatHost, 'ratpits_phase'), 0);
assert.equal(winA.modalMain, -1, 'declining closes the first offer panel');
assert.equal(winB.modalMain, -1, 'host settlement closes the other offer panel before acquiring its player');
assert.equal(coinTotal(winA, winB), 200, 'rematch cancellation leaves both new stakes untouched');

// A live retreat is refused without worn Catspeak and preserves the cat after the opponent wins.
{
  const a = makeTrainer(3, { catType: 'overgrowncat', coins: 100 });
  const b = makeTrainer(3, { catType: 'overgrowncat', coins: 100 });
  const host = openOffer(a, b);
  startMatch(a, b, host);
  const uidA = a.getVar(v('follower_uid'));
  const catA = npcByUid(uidA);
  const wall = target('loc', 'vc_dwarfrat_wall1', rows => rows.find(row => row.mx === 30 && row.mz === 73));
  assert(map.findPath(0, venues[2].owner[0][0], venues[2].owner[0][1], wall.stand[1], wall.stand[2]).length,
    'the authentic outside stand can reach the native dwarf-rat wall');
  interact(a, wall, T.OPLOC1, null, [1]);
  assert.equal(npcValue(host, 'ratpits_phase'), 2, 'retreat without the amulet is refused');
  add(a, 'ics_little_amulet_of_catspeak', 1, worn);
  interact(a, wall, T.OPLOC1, null, [1]);
  assert.equal(npcValue(host, 'ratpits_phase'), 3, 'the worn amulet enables retreat');
  tickHost(host);
  assert.equal(npcValue(host, 'ratpits_phase'), 0);
  assert.equal(a.getVar(v('follower_uid')), uidA, 'retreat preserves the live cat follower');
  assert.equal(npcByUid(uidA), catA, 'the same native cat NPC survives the retreat');
  assert.equal(npcValue(host, 'ratpits_dead_a'), 0);
  assert.equal(b.invTotal(inv, obj('coins')), 200, 'the non-retreating opponent receives the forfeited pot');
}

// Real item-on-wall dispatch heals only the owner's active cat and consumes accepted fish once.
{
  const a = makeTrainer(4), b = makeTrainer(4);
  const host = openOffer(a, b);
  startMatch(a, b, host);
  const feline = cat(a);
  const maximumHp = feline.levels[NpcStat.HITPOINTS];
  const wall = target('loc', 'vc_rat_wall2', rows => rows.find(row => row.mx === 46 && row.mz === 150));
  add(a, 'raw_shrimp', 3); add(a, 'raw_tuna'); add(a, 'trout');
  setHp(feline, 1);
  interact(a, wall, T.OPLOCU, 'trout');
  assert.equal(feline.levels[NpcStat.HITPOINTS], 1, 'an unsupported fish does not heal');
  assert.equal(a.invTotal(inv, obj('trout')), 1, 'an unsupported fish is not consumed');
  interact(a, wall, T.OPLOCU, 'raw_shrimp');
  assert.equal(feline.levels[NpcStat.HITPOINTS], 4, 'raw shrimp applies the named three-point heal');
  assert.equal(a.invTotal(inv, obj('raw_shrimp')), 2);
  setHp(feline, 1);
  interact(a, wall, T.OPLOCU, 'raw_tuna');
  assert.equal(feline.levels[NpcStat.HITPOINTS], 11, 'raw tuna applies the named ten-point heal');
  assert.equal(a.invTotal(inv, obj('raw_tuna')), 0);
  interact(a, wall, T.OPLOCU, 'raw_shrimp');
  assert.equal(feline.levels[NpcStat.HITPOINTS], maximumHp, 'healing is capped at the native cat profile');
  interact(a, wall, T.OPLOCU, 'raw_shrimp');
  assert.equal(a.invTotal(inv, obj('raw_shrimp')), 1, 'a full-health cat consumes no extra fish');
  run(a, '[proc,ratpits_logout]');
  tickHost(host);
  assert.equal(coinTotal(a, b), 200);
  assert.equal(npcValue(host, 'ratpits_phase'), 0);
}

// Real combat also proves cat death removes only the defeated follower and does not reward that cat.
{
  const a = makeTrainer(3, { catType: 'overgrowncat', coins: 100 });
  const b = makeTrainer(3, { catType: 'overgrowncat', coins: 100 });
  const host = openOffer(a, b);
  const seedA = (0x78000000 | (40 << 11) | (4 << 20) | 11) >>> 0;
  const seedB = (0x78000000 | (50 << 11) | (6 << 20) | 13) >>> 0;
  setGrowth(a, seedA); setGrowth(b, seedB);
  startMatch(a, b, host);
  const deadUid = a.getVar(v('follower_uid'));
  const catA = npcByUid(deadUid), catB = cat(b);
  setHp(catA, 1);
  setHp(catB, 100);
  setHp(getRat(host, 1), 10000);
  setHp(getRat(host, 2), 1);
  const fatalRound = [0, 0.999, 0.999, 0, 0.999, 0.999, 0, 0.999];
  withRandomSequence(fatalRound, () => tickHost(host));
  assert.equal(npcValue(host, 'ratpits_dead_a'), 1);
  assert.equal(npcValue(host, 'ratpits_score_b'), 1);
  assert.equal(npcValue(host, 'ratpits_phase'), 0);
  assert.equal(a.getVar(v('follower_uid')), -1, 'death clears the follower UID');
  assert.equal(a.getVar(v('follower_obj')), -1, 'death clears the follower item');
  assert(![...World.npcs].some(npc => npc.uid === deadUid), 'the defeated cat is removed from the world');
  assert.equal(b.getVar(v('follower_uid')), catB.uid, 'the surviving cat remains owned');
  assert.equal(growth(a), (seedA & 0xf8000000) >>> 0, 'death clears the former cat state without rewards and preserves RFD high bits');
  assert.equal((growth(b) >>> 27) & 15, 15, 'the winning cat preserves unrelated high bits');
  assert.equal((growth(b) >>> 11) & 511, 51, 'the surviving winner receives growth');
  assert.equal(coinTotal(a, b), 200, 'cat death still settles one complete pot');
}

// Fatigue ties and the absolute deadline refund both escrow ledgers without granting training.
for (const hardDeadline of [false, true]) {
  const a = makeTrainer(2, { catType: 'growncat', coins: 100 });
  const b = makeTrainer(2, { catType: 'growncat', coins: 100 });
  const host = openOffer(a, b);
  const seedA = (0x78000000 | (60 << 11) | (8 << 20) | 5) >>> 0;
  const seedB = (0x78000000 | (61 << 11) | (9 << 20) | 6) >>> 0;
  setGrowth(a, seedA); setGrowth(b, seedB);
  startMatch(a, b, host);
  putNpcValue(host, 'ratpits_score_a', hardDeadline ? 4 : 3);
  putNpcValue(host, 'ratpits_score_b', hardDeadline ? 0 : 3);
  if (hardDeadline) {
    const deadline = npcValue(host, 'ratpits_deadline');
    putNpcValue(host, 'ratpits_fatigue_at', deadline + 1);
    World.currentTick = deadline;
  } else {
    putNpcValue(host, 'ratpits_fatigue_at', World.currentTick);
  }
  tickHost(host);
  assert.equal(npcValue(host, 'ratpits_phase'), 0, hardDeadline ? 'the hard match deadline aborts' : 'fatigue settles a tie');
  assert.equal(a.invTotal(inv, obj('coins')), 100);
  assert.equal(b.invTotal(inv, obj('coins')), 100);
  assert.equal(a.invTotal(purse, obj('coins')) + b.invTotal(purse, obj('coins')), 0);
  assert.equal(growth(a), seedA, 'draw/abort awards no training to A');
  assert.equal(growth(b), seedB, 'draw/abort awards no training to B');
  assert.equal(coinTotal(a, b), 200);
}

// Actual global logout recovers only the caller synchronously and preserves continuation identity.
{
  const a = makeTrainer(2, { catType: 'growncat', coins: 100 });
  const b = makeTrainer(2, { catType: 'growncat', coins: 100 });
  const host = openOffer(a, b);
  startMatch(a, b, host);
  const bCat = cat(b);
  const bLastLogout = b.getVar(v('last_logout'));
  run(a, '[logout,_]');
  assert.equal(a.getVar(v('last_logout')), World.currentTick, 'the original caller receives global logout bookkeeping');
  assert.equal(b.getVar(v('last_logout')), bLastLogout, 'releasing the opponent does not write its logout timestamp');
  assert.equal(npcValue(host, 'ratpits_phase'), 3, 'logout leaves only deferred opponent release for the controller timer');
  assert.equal(a.invTotal(purse, obj('coins')) + b.invTotal(purse, obj('coins')), 100,
    'the offline caller is refunded while the opponent remains in escrow');
  assert.equal(coinTotal(a, b), 200, 'logout preserves the complete wager ledger');
  tickHost(host);
  assert.equal(npcValue(host, 'ratpits_phase'), 0, 'the next native controller tick completes the refund');
  assert.equal(b.invTotal(purse, obj('coins')), 0);
  assert.equal(b.invTotal(inv, obj('coins')), 100);
  assert.equal(a.invTotal(purse, obj('coins')), 0);
  assert.equal(coinTotal(a, b), 200);
  assert.equal(b.getVar(v('follower_uid')), bCat.uid, 'the opponent retains its follower');
  assert.equal(bCat.targetOp, NpcMode.PLAYERFOLLOW, 'the opponent follower remains in follow mode after settlement');
  assert.equal(bCat.getVar(npcVar('npc_attacking_uid')), b.uid, 'the opponent follower remains owned by B');
}

// Missing-player recovery releases the controller and retains offline escrow for the next login.
{
  const a = makeTrainer(1, { catType: 'kittenpet1', coins: 100 });
  const b = makeTrainer(1, { catType: 'kittenpet1', coins: 100 });
  const host = openOffer(a, b);
  startMatch(a, b, host);
  a.unlink();
  delete World.players[a.slot];
  a.isActive = false;
  tickHost(host);
  assert.equal(npcValue(host, 'ratpits_phase'), 0, 'the absent-owner path releases the native controller');
  assert.equal(npcValue(host, 'ratpits_player_a'), -1, 'the missing owner is removed from the session');
  assert.equal(a.invTotal(purse, obj('coins')), 100, 'offline escrow remains as permanent claimable credit');
  assert.equal(b.invTotal(purse, obj('coins')), 0);
  assert.equal(b.invTotal(inv, obj('coins')), 100, 'the present player receives their own refund');
  assert.equal(coinTotal(a, b), 200, 'offline retention conserves all wagered coins');
  a.isActive = true;
  World.players[a.slot] = a;
  World.playerLoop.add(a.hash64, a);
  run(a, '[login,_]');
  assert.equal(a.invTotal(purse, obj('coins')), 0, 'login claims offline escrow exactly once');
  assert.equal(a.invTotal(inv, obj('coins')), 100);
  assert.equal(coinTotal(a, b), 200);
}

// Both-full settlement retains the purse, then a single free slot and repeated login/claims pay it once.
{
  const a = makeTrainer(2, { catType: 'growncat', coins: 100 });
  const b = makeTrainer(2, { catType: 'growncat', coins: 100 });
  const host = openOffer(a, b);
  startMatch(a, b, host);
  fillInventory(a, inv);
  fillBank(a);
  putNpcValue(host, 'ratpits_result', 1);
  putNpcValue(host, 'ratpits_phase', 3);
  runNpcProc(host, 'ratpits_finish');
  assert.equal(a.invTotal(purse, obj('coins')), 200, 'full inventory and bank retain the entire award as credit');
  assert.equal(a.invTotal(inv, obj('coins')), 0);
  assert.equal(a.invTotal(bank, obj('coins')), 0);
  assert.equal(coinTotal(a, b), 200);
  runNpcProc(host, 'ratpits_finish');
  run(a, '[proc,ratpits_claim]');
  assert.equal(a.invTotal(purse, obj('coins')), 200, 'repeated finish and full-capacity claim do not duplicate credit');
  a.invDel(inv, obj('bronze_dagger'), 1);
  run(a, '[proc,ratpits_claim]');
  assert.equal(a.invTotal(purse, obj('coins')), 0);
  assert.equal(a.invTotal(inv, obj('coins')), 200, 'a free inventory slot claims the credit once');
  run(a, '[proc,ratpits_claim]');
  run(a, '[logout,_]');
  run(a, '[login,_]');
  assert.equal(a.invTotal(inv, obj('coins')), 200, 'repeated logout/login cannot duplicate a settled award');
  assert.equal(a.invTotal(purse, obj('coins')), 0);
  assert.equal(coinTotal(a, b), 200);
}

// Every native controller completes a whole real five-rat race and permits another session.
for (const spec of venues) {
  const a = makeTrainer(spec.id), b = makeTrainer(spec.id);
  const host = openOffer(a, b);
  startMatch(a, b, host);
  setHp(cat(a), 100); setHp(cat(b), 100);
  for (let round = 0; round < 5; round++) {
    setHp(getRat(host, 1), 1);
    setHp(getRat(host, 2), 10000);
    withRandomSequence(winningRounds, () => tickHost(host));
  }
  assert.equal(npcValue(host, 'ratpits_score_a'), 5, `venue ${spec.id} completes its five real rat kills`);
  assert.equal(npcValue(host, 'ratpits_phase'), 0);
  assert.equal(a.invTotal(inv, obj('coins')), 200);
  assert.equal(b.invTotal(inv, obj('coins')), 0);
  assert.equal(coinTotal(a, b), 200, `venue ${spec.id} transfers exactly one pot`);
  add(b, 'coins', 100);
  moveToLobby(a, spec.id); moveToLobby(b, spec.id);
  const repeat = openOffer(a, b);
  button(a, 'players_cat:com_7');
  tickHost(repeat);
  assert.equal(npcValue(repeat, 'ratpits_phase'), 0, `venue ${spec.id} resets for an immediate rematch`);
}

console.log('Rat Pits: four authentic venues, admission, escrow, tactics, combat, recovery and repeatable settlement passed');
process.exit(0);
