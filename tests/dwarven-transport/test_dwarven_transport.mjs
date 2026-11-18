/**
 * Compiled dwarven boat, ferry, ticket and cart regressions. Run after a full pack
 * from the engine directory:
 *   node --import tsx ../content/tests/dwarven-transport/test_dwarven_transport.mjs
 * This uses the packed world and engine dispatch; it does not start a live server.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BlockWalk, EntityLifeCycle, IfSetText, MessageGame, Npc, Player, ResumePauseButton,
  ResumePauseButtonHandler, ScriptRunner, ScriptState, ServerTriggerType, World, content,
  floorTiles, locFor, map, nativeLocRows, nativeNpcRows, reachable, requiredId, tileOf,
  types, walkable
} from '../regicide-travel/runtime.mjs';

const failures = [];
let passed = 0;
let playerSerial = 0;
const packetsByPlayer = new WeakMap();
const pauseHandler = new ResumePauseButtonHandler();
const inventoryId = requiredId(types.InvType, 'inv');
const wornInventoryId = requiredId(types.InvType, 'worn');
const coinsId = requiredId(types.ObjType, 'coins');
const giantDwarfQuestBit = requiredId(types.VarBitType, 'giantdwarf_quest');
const fishingVarp = requiredId(types.VarPlayerType, 'fishingcompo');
const fishingComplete = readConstant('fishingcompo_complete');
const ticketNames = [
  'dwarf_minecart_ticket_kelda_ice',
  'dwarf_minecart_ticket_ice_kelda',
  'dwarf_minecart_ticket_kelda_whitewolf',
  'dwarf_minecart_ticket_whitewolf_kelda'
];
const ticketIds = new Map(ticketNames.map(name => [name, requiredId(types.ObjType, name)]));
const choiceMenuIds = new Set(['multi2', 'multi3', 'multi4'].map(name => requiredId(types.Component, name)));
const buyStationChoice = /I'd like to buy a ticket\./i;
const fullFareChoice = /^Buy\.$/i;
const leaveStationChoice = /I have to go\./i;

function check(name, run) {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name, message });
    console.error(`FAIL ${name}: ${message}`);
  }
}

function readConstant(name) {
  const source = readFileSync(path.join(content, 'scripts/general/configs/quest.constant'), 'utf8');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\^${escaped}\\s*=\\s*(-?\\d+)\\s*$`, 'm').exec(source);
  assert.ok(match, `missing published constant ${name}`);
  return Number(match[1]);
}

function playerAt(tile) {
  const slot = ++playerSerial;
  const player = new Player(`dwarven_transport_test_${slot}`, BigInt(slot), 0n);
  player.slot = slot;
  player.pid = slot;
  player.uid = ((Number(player.username37 & 0x1fffffn) << 11) | slot) >>> 0;
  player.vars.fill(0);
  // Fixture: all music is already unlocked. Native region music must not make
  // the stronger all-varps-unchanged assertion mistake a song unlock for quest progress.
  for (let group = 1; group <= 14; group++) {
    player.setVar(requiredId(types.VarPlayerType, `musicmulti_${group}`), -1);
  }
  player.baseLevels.fill(99);
  player.levels.fill(99);
  [player.level, player.x, player.z] = tile;
  player.buildArea.originX = Math.floor(tile[1] / 8) * 8;
  player.buildArea.originZ = Math.floor(tile[2] / 8) * 8;
  World.players[slot] = player;
  const packets = [];
  packetsByPlayer.set(player, packets);
  player.write = message => packets.push(message);
  return player;
}

function tileText(player) {
  return packetsByPlayer.get(player)
    .filter(message => message instanceof IfSetText || message instanceof MessageGame)
    .map(message => message instanceof MessageGame ? message.msg : message.text)
    .join('\n').replace(/\s+/g, ' ');
}

function packetTexts(player) {
  return packetsByPlayer.get(player)
    .filter(message => message instanceof IfSetText)
    .map(message => [message.component, message.text]);
}

function setGiantDwarfStage(player, value) {
  player.setVarBit(giantDwarfQuestBit, value);
}

function setFishingComplete(player, complete) {
  player.setVar(fishingVarp, complete ? fishingComplete : 0);
}

function variableSnapshot(player) {
  return Array.from(player.vars);
}

function findNpcRow(name, index = 0) {
  const rows = nativeNpcRows(name);
  assert.ok(rows.length > index, `native map placement required: ${name} #${index + 1}`);
  return rows[index];
}

let spawnedNpcSerial = 0;
function spawnNativeNpc(row) {
  const type = types.NpcType.get(row.id);
  assert.ok(type, `packed visible NPC type exists for ${row.name}`);
  assert.equal(type.id, row.id, `${row.name} map row uses its visible packed NPC type`);
  const nid = World.npcs.next();
  const npc = new Npc(
    row.level, row.x, row.z, type.size, type.size, EntityLifeCycle.RESPAWN,
    nid, row.id, BlockWalk.NONE
  );
  npc.lastMovement = -100 - spawnedNpcSerial++;
  World.addNpc(npc, -1);
  return npc;
}

function dispatchNpc(player, row) {
  const npc = spawnNativeNpc(row);
  player.target = npc;
  player.targetOp = ServerTriggerType.OPNPC1 - 7;
  const selected = player.getOpTrigger();
  assert.ok(selected, `engine NPC dispatch resolves the visible ${row.name} Talk-to form`);
  assert.equal(selected.name, `[opnpc1,${row.name}]`, `${row.name} runs its visible Talk-to trigger`);
  return { npc, selected };
}

function dispatchLoc(player, row) {
  const loc = locFor(row);
  player.target = loc;
  player.targetOp = ServerTriggerType.OPLOC1 - 7;
  const selected = player.getOpTrigger();
  assert.ok(selected, `engine loc dispatch resolves the native ${row.name} Ride form`);
  assert.equal(selected.name, `[oploc1,${row.name}]`, `${row.name} runs its visible Ride trigger`);
  return { loc, selected };
}

function menuOptions(player) {
  const latestText = new Map();
  for (const [component, value] of packetTexts(player)) latestText.set(component, value);
  return [...new Set(player.resumeButtons ?? [])]
    .filter(component => types.Component.get(component)?.rootLayer === player.modalChat)
    .map(component => ({ component, label: latestText.get(component) }))
    .filter(option => typeof option.label === 'string' && option.label.length > 0);
}

function chooseMenuOption(player, state, wanted, menuLog) {
  const options = menuOptions(player);
  assert.ok(options.length >= 2, 'packed choice menu exposes its visible button labels');
  const labels = options.map(option => option.label).join('\n');
  assert.doesNotMatch(labels, /grand exchange/i, 'no Grand Exchange destination appears in a transport choice menu');
  menuLog.push(options.map(option => option.label));

  const choice = wanted instanceof RegExp ? { match: wanted } : wanted;
  assert.ok(choice && choice.match instanceof RegExp, 'menu choice is a regular expression or a checked selection');
  if (choice.absent) assert.doesNotMatch(labels, choice.absent, `transport menu excludes ${choice.absent}`);
  const matches = options.filter(option => choice.match.test(option.label));
  assert.equal(matches.length, 1, `choice ${choice.match} is offered exactly once; options: ${labels}`);
  player.lastCom = matches[0].component;
  assert.ok(
    pauseHandler.handle(new ResumePauseButton(matches[0].component), player),
    `production Continue handler accepts choice ${matches[0].label}`
  );
  assert.notEqual(state.execution, ScriptState.ABORTED, 'script remains live after menu selection');
}

function finishScript(player, state, choices = [], defaultChoice = null) {
  const menuLog = [];
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 100; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script?.name ?? 'transport script'} aborts`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      if (choiceMenuIds.has(player.modalChat)) {
        const choice = choices.length ? choices.shift() : defaultChoice;
        assert.ok(choice, 'unexpected interactive transport choice');
        chooseMenuOption(player, state, choice, menuLog);
      } else {
        assert.ok(pauseHandler.handle(new ResumePauseButton(0), player), 'production Continue handler accepts dialogue pause');
        assert.notEqual(state.execution, ScriptState.ABORTED, 'script remains live after Continue');
      }
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
      player.delayed = false;
      player.executeScript(state, true, true);
    } else {
      assert.fail(`unexpected script suspension ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'packed transport script finishes within 100 offline steps');
  assert.equal(player.delayed, false, 'script delay has settled');
  assert.equal(choices.length, 0, 'all expected transport menu selections were consumed');
  return menuLog;
}

function runSelectedInteraction(player, selected, target, choices = [], defaultChoice = null) {
  const beforeVars = variableSnapshot(player);
  const state = ScriptRunner.init(selected, player, target);
  player.executeScript(state, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${selected.name} aborts on entry`);
  const menus = finishScript(player, state, choices, defaultChoice);
  assert.deepEqual(variableSnapshot(player), beforeVars, `${selected.name} does not write quest or transport state`);
  return { state, menus };
}

function adjacentLocTile(row) {
  for (let radius = 1; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) + Math.abs(dz) !== radius) continue;
        const tile = [row.level, row.x + dx, row.z + dz];
        if (!floorTiles.has(tile.join(','))) continue;
        if (map.isMapBlocked(tile[1], tile[2], tile[0])) continue;
        if (reachable(tile, row)) return tile;
      }
    }
  }
  assert.fail(`no collision-free approach to native cart ${row.name} ${row.coord}`);
}

function bag(player) {
  return player.getInventory(inventoryId);
}

function addCoins(player, amount) {
  if (amount > 0) bag(player).add(coinsId, amount);
}

function assertTicketCounts(inventory, expectedName = null, expectedCount = 0) {
  for (const name of ticketNames) {
    assert.equal(
      inventory.getItemCount(ticketIds.get(name)),
      name === expectedName ? expectedCount : 0,
      `${name} ticket count`
    );
  }
}

function buyChoice(pattern, absent = null) {
  return absent ? { match: pattern, absent } : pattern;
}

function ticketSellerTalk(player, row, destination, purchaseChoice = fullFareChoice, destinationAbsent = null, purchaseAbsent = null) {
  const { npc, selected } = dispatchNpc(player, row);
  const destinationChoice = destination === 'ice'
    ? buyChoice(/To Ice Mountain\./i, destinationAbsent)
    : buyChoice(/To White Wolf Mountain\./i, destinationAbsent);
  const purchase = buyChoice(purchaseChoice, purchaseAbsent);
  return runSelectedInteraction(
    player, selected, npc,
    [buyStationChoice, destinationChoice, purchase], leaveStationChoice
  );
}

function returnTicketSellerTalk(player, row, purchaseChoice = fullFareChoice, purchaseAbsent = null) {
  const { npc, selected } = dispatchNpc(player, row);
  return runSelectedInteraction(
    player, selected, npc,
    [buyStationChoice, buyChoice(purchaseChoice, purchaseAbsent)], leaveStationChoice
  );
}

function ticketId(name) {
  const id = ticketIds.get(name);
  assert.ok(Number.isInteger(id), `known directional ticket ${name}`);
  return id;
}

function assertLanding(tile, label) {
  walkable(tile, label);
  const [level, x, z] = tile;
  const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => {
    const nextX = x + dx;
    const nextZ = z + dz;
    return floorTiles.has([level, nextX, nextZ].join(',')) &&
      !map.isMapBlocked(nextX, nextZ, level) &&
      map.isLineOfWalk(level, x, z, nextX, nextZ);
  });
  assert.ok(exits.length > 0, `${label}: landing has a collision-free, walkable exit neighbor`);
}

function rideCart(row, ticketName, destination, { stage = 1, fishing = false, count = 1, coins = 17 } = {}) {
  const start = adjacentLocTile(row);
  const player = playerAt(start);
  setGiantDwarfStage(player, stage);
  setFishingComplete(player, fishing);
  const inventory = bag(player);
  inventory.add(ticketId(ticketName), count);
  addCoins(player, coins);
  const beforeVars = variableSnapshot(player);
  const { loc, selected } = dispatchLoc(player, row);
  const { menus } = runSelectedInteraction(player, selected, loc);
  assert.deepEqual(tileOf(player), destination, `${row.name} lands at ${destination.join(',')}`);
  assertTicketCounts(inventory, ticketName, count - 1);
  assert.equal(inventory.getItemCount(coinsId), coins, `${row.name} consumes no gold while riding`);
  assert.deepEqual(variableSnapshot(player), beforeVars, `${row.name} ride leaves quest and transport vars unchanged`);
  assert.deepEqual(menus, [], `${row.name} Ride uses its native track, not a destination menu`);
  assertLanding(destination, `${row.name} landing`);
  return player;
}

function refuseCart(row, ticketName, { stage = 1, fishing = false, count = 1, coins = 17 } = {}) {
  const start = adjacentLocTile(row);
  const player = playerAt(start);
  setGiantDwarfStage(player, stage);
  setFishingComplete(player, fishing);
  const inventory = bag(player);
  if (ticketName) inventory.add(ticketId(ticketName), count);
  addCoins(player, coins);
  const beforeVars = variableSnapshot(player);
  const { loc, selected } = dispatchLoc(player, row);
  const { menus } = runSelectedInteraction(player, selected, loc);
  assert.deepEqual(tileOf(player), start, `${row.name} refusal does not move the player`);
  if (ticketName) assert.equal(inventory.getItemCount(ticketId(ticketName)), count, `${row.name} refusal keeps the ticket`);
  assert.equal(inventory.getItemCount(coinsId), coins, `${row.name} refusal does not charge gold`);
  assert.deepEqual(variableSnapshot(player), beforeVars, `${row.name} refusal leaves vars unchanged`);
  assert.deepEqual(menus, [], `${row.name} refusal does not introduce a cart menu`);
  return player;
}

// UNKNOWN engineering landing candidates; each is verified against packed floor, collision and an exit neighbor.
const destinations = [
  ['city boat dock', [0, 2888, 10227]],
  ['mines boat dock', [0, 2842, 10129]],
  ['ferry entrance', [0, 2839, 10128]],
  ['ferry mine', [0, 2855, 10144]],
  ['Keldagrim train dock', [0, 2927, 10180]],
  ['Ice Mountain cart exit', [0, 2994, 9845]],
  ['White Wolf Mountain cart exit', [0, 2874, 9873]]
];

check('packed world exposes original directional tickets as four separate unstackable items', () => {
  assert.equal(new Set(ticketIds.values()).size, 4, 'the four original 377 tickets have distinct packed identities');
  for (const name of ticketNames) {
    const player = playerAt([0, 1, 1]);
    const inventory = bag(player);
    const capacity = inventory.capacity;
    inventory.add(ticketId(name), 2);
    assert.equal(inventory.getItemCount(ticketId(name)), 2, `${name} accepts two original tickets`);
    assert.equal(inventory.freeSlotCount, capacity - 2, `${name} is unstackable in the player inventory`);
  }
});

for (const [label, tile] of destinations) {
  check(`${label} planned landing has packed floor, collision clearance and an exit`, () => {
    assertLanding(tile, label);
  });
}

// UNKNOWN cell-entry fixture tiles; both are checked against the compiled map before use.
const liveEntryFixtures = [
  ['city boatman entry', [0, 2888, 10227]],
  ['Track 1 conductor entry', [0, 2918, 10180]]
];
for (const [label, tile] of liveEntryFixtures) {
  check(`${label} has a packed walkable entry tile and exit`, () => {
    assertLanding(tile, label);
  });
}

const conductorRows = new Map();
for (let number = 1; number <= 8; number++) {
  const name = `dwarf_city_train_conductor${number}`;
  conductorRows.set(number, nativeNpcRows(name));
}

check('every placed conductor type uses its real visible map form; conductor 4 tests both placements', () => {
  for (let number = 1; number <= 8; number++) {
    const rows = conductorRows.get(number);
    assert.ok(rows.length > 0, `native placement exists for conductor ${number}`);
  }
  assert.equal(conductorRows.get(4).length, 2, 'both native conductor 4 placements are covered');
});

const sellerPlacementCases = [
  { number: 1, placement: 0, destination: 'ice' },
  { number: 2, placement: 0, destination: 'whitewolf' },
  { number: 4, placement: 0, destination: 'ice' },
  { number: 4, placement: 1, destination: 'whitewolf' },
  { number: 8, placement: 0, destination: 'ice' }
];
for (const item of sellerPlacementCases) {
  check(`Keldagrim conductor ${item.number} placement ${item.placement + 1} sells its selected outbound ticket`, () => {
    const row = conductorRows.get(item.number)[item.placement];
    const player = playerAt([row.level, row.x, row.z]);
    setGiantDwarfStage(player, 1);
    setFishingComplete(player, true);
    const inventory = bag(player);
    addCoins(player, 1000);
    const beforeTile = tileOf(player);
    ticketSellerTalk(player, row, item.destination);
    const expectedTicket = item.destination === 'ice'
      ? 'dwarf_minecart_ticket_kelda_ice'
      : 'dwarf_minecart_ticket_kelda_whitewolf';
    const fare = item.destination === 'ice' ? 150 : 100;
    assertTicketCounts(inventory, expectedTicket, 1);
    assert.equal(inventory.getItemCount(coinsId), 1000 - fare, 'purchase consumes the route fare');
    assert.deepEqual(tileOf(player), beforeTile, 'buying a ticket does not teleport');
  });
}

for (const [number, phrase] of [[3, /traffic/i], [5, /break/i]]) {
  check(`conductor ${number} is classified as dialogue-only, not a ticket seller`, () => {
    const row = conductorRows.get(number)[0];
    const player = playerAt([row.level, row.x, row.z]);
    setGiantDwarfStage(player, 1);
    setFishingComplete(player, true);
    const inventory = bag(player);
    addCoins(player, 500);
    const { npc, selected } = dispatchNpc(player, row);
    runSelectedInteraction(player, selected, npc, number === 5 ? [buyStationChoice] : []);
    assert.match(tileText(player), phrase, `conductor ${number} presents its assigned dialogue classification`);
    assert.equal(inventory.getItemCount(coinsId), 500, 'dialogue-only conductor takes no money');
    assertTicketCounts(inventory);
  });
}

check('Ice Mountain return seller 7 sells the exact return ticket without requiring Fishing completion', () => {
  const row = conductorRows.get(7)[0];
  const player = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(player, 1);
  setFishingComplete(player, false);
  const inventory = bag(player);
  addCoins(player, 150);
  returnTicketSellerTalk(player, row);
  assertTicketCounts(inventory, 'dwarf_minecart_ticket_ice_kelda', 1);
  assert.equal(inventory.getItemCount(coinsId), 0);
  assert.deepEqual(tileOf(player), [row.level, row.x, row.z], 'ticket purchase does not move the player');
});

check('White Wolf return seller 6 sells only after Fishing completion', () => {
  const row = conductorRows.get(6)[0];
  const player = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(player, 1);
  setFishingComplete(player, false);
  const inventory = bag(player);
  addCoins(player, 100);
  const { npc, selected } = dispatchNpc(player, row);
  runSelectedInteraction(player, selected, npc, [buyStationChoice], leaveStationChoice);
  assertTicketCounts(inventory);
  assert.equal(inventory.getItemCount(coinsId), 100, 'Fishing gate refusal keeps the fare');

  const allowed = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(allowed, 1);
  setFishingComplete(allowed, true);
  const allowedInventory = bag(allowed);
  addCoins(allowed, 100);
  returnTicketSellerTalk(allowed, row);
  assertTicketCounts(allowedInventory, 'dwarf_minecart_ticket_whitewolf_kelda', 1);
  assert.equal(allowedInventory.getItemCount(coinsId), 0);
});

check('ticket seller and all station destination menus enforce access, hide White Wolf before Fishing and omit GE', () => {
  const row = conductorRows.get(1)[0];
  const locked = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(locked, 0);
  setFishingComplete(locked, true);
  const lockedInventory = bag(locked);
  addCoins(locked, 150);
  const { npc, selected } = dispatchNpc(locked, row);
  runSelectedInteraction(locked, selected, npc, [buyStationChoice], leaveStationChoice);
  assertTicketCounts(lockedInventory);
  assert.equal(lockedInventory.getItemCount(coinsId), 150, 'Giant Dwarf access refusal keeps the fare');

  const noFishing = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(noFishing, 1);
  setFishingComplete(noFishing, false);
  const inventory = bag(noFishing);
  addCoins(noFishing, 150);
  ticketSellerTalk(
    noFishing, row, 'ice', fullFareChoice,
    /White Wolf Mountain/i
  );
  assertTicketCounts(inventory, 'dwarf_minecart_ticket_kelda_ice', 1);
  assert.equal(inventory.getItemCount(coinsId), 0);
});

check('ticket station supports cancelling at the station, destination and purchase prompts', () => {
  const row = conductorRows.get(1)[0];
  const cancelStation = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(cancelStation, 1);
  setFishingComplete(cancelStation, true);
  const stationInventory = bag(cancelStation);
  addCoins(cancelStation, 200);
  const stationDispatch = dispatchNpc(cancelStation, row);
  runSelectedInteraction(cancelStation, stationDispatch.selected, stationDispatch.npc, [/I have to go\./i]);
  assertTicketCounts(stationInventory);
  assert.equal(stationInventory.getItemCount(coinsId), 200);

  const cancelDestination = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(cancelDestination, 1);
  setFishingComplete(cancelDestination, true);
  const destinationInventory = bag(cancelDestination);
  addCoins(cancelDestination, 200);
  const destinationDispatch = dispatchNpc(cancelDestination, row);
  runSelectedInteraction(cancelDestination, destinationDispatch.selected, destinationDispatch.npc, [
    buyStationChoice, /Nowhere\./i
  ]);
  assertTicketCounts(destinationInventory);
  assert.equal(destinationInventory.getItemCount(coinsId), 200);

  const cancelPurchase = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(cancelPurchase, 1);
  setFishingComplete(cancelPurchase, true);
  const purchaseInventory = bag(cancelPurchase);
  addCoins(cancelPurchase, 200);
  ticketSellerTalk(cancelPurchase, row, 'ice', /^Don't buy\.$/i);
  assertTicketCounts(purchaseInventory);
  assert.equal(purchaseInventory.getItemCount(coinsId), 200);
});

check('ticket purchase refuses no money without charging or moving', () => {
  const row = conductorRows.get(1)[0];
  const player = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(player, 1);
  setFishingComplete(player, true);
  const inventory = bag(player);
  const before = tileOf(player);
  ticketSellerTalk(player, row, 'ice');
  assertTicketCounts(inventory);
  assert.equal(inventory.getItemCount(coinsId), 0);
  assert.deepEqual(tileOf(player), before);
});

check('ticket purchase refuses a full inventory without consuming coins', () => {
  const row = conductorRows.get(1)[0];
  const player = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(player, 1);
  setFishingComplete(player, true);
  const inventory = bag(player);
  const blocker = ticketId('dwarf_minecart_ticket_ice_kelda');
  const fareWithRemainder = 151;
  inventory.add(coinsId, fareWithRemainder);
  for (let slot = 0; slot < inventory.capacity - 1; slot++) inventory.add(blocker, 1);
  assert.equal(inventory.freeSlotCount, 0, 'one coin remainder and unstackable tickets occupy every bag slot');
  const before = tileOf(player);
  ticketSellerTalk(player, row, 'ice');
  assert.equal(inventory.getItemCount(coinsId), fareWithRemainder, 'no-space refusal keeps all coins');
  assert.equal(inventory.getItemCount(ticketId('dwarf_minecart_ticket_ice_kelda')), inventory.capacity - 1);
  assert.equal(inventory.getItemCount(ticketId('dwarf_minecart_ticket_kelda_ice')), 0);
  assert.deepEqual(tileOf(player), before);
});

check('exact fare frees its coin slot and still permits the unstackable ticket', () => {
  const row = conductorRows.get(1)[0];
  const player = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(player, 1);
  setFishingComplete(player, true);
  const inventory = bag(player);
  const blocker = ticketId('dwarf_minecart_ticket_ice_kelda');
  inventory.add(coinsId, 150);
  for (let slot = 0; slot < inventory.capacity - 1; slot++) inventory.add(blocker, 1);
  assert.equal(inventory.freeSlotCount, 0, 'the exact fare begins with no free slot');
  ticketSellerTalk(player, row, 'ice');
  assert.equal(inventory.getItemCount(coinsId), 0);
  assert.equal(inventory.getItemCount(ticketId('dwarf_minecart_ticket_ice_kelda')), inventory.capacity - 1);
  assert.equal(inventory.getItemCount(ticketId('dwarf_minecart_ticket_kelda_ice')), 1, 'the exact coin stack frees its slot for one ticket');
  assert.equal(inventory.freeSlotCount, 0, 'the ticket replaces the consumed exact coin stack');
});

check('worn unlocked ring of charos offers the explicit half-fare option', () => {
  const row = conductorRows.get(1)[0];
  const player = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(player, 1);
  setFishingComplete(player, true);
  const ring = requiredId(types.ObjType, 'ring_of_charos_unlocked');
  player.getInventory(wornInventoryId).add(ring, 1);
  const inventory = bag(player);
  addCoins(player, 75);
  ticketSellerTalk(player, row, 'ice', /Only pay half/i);
  assertTicketCounts(inventory, 'dwarf_minecart_ticket_kelda_ice', 1);
  assert.equal(inventory.getItemCount(coinsId), 0, 'the explicit Charm option costs half the Ice fare');
});

for (const ringCase of [
  { label: 'held unlocked ring', inventory: 'bag', name: 'ring_of_charos_unlocked' },
  { label: 'worn base ring', inventory: 'worn', name: 'ring_of_charos' }
]) {
  check(`${ringCase.label} does not offer the half-fare choice`, () => {
    const row = conductorRows.get(1)[0];
    const player = playerAt([row.level, row.x, row.z]);
    setGiantDwarfStage(player, 1);
    setFishingComplete(player, true);
    const ringInventory = ringCase.inventory === 'worn' ? player.getInventory(wornInventoryId) : bag(player);
    ringInventory.add(requiredId(types.ObjType, ringCase.name), 1);
    const inventory = bag(player);
    addCoins(player, 150);
    ticketSellerTalk(player, row, 'ice', fullFareChoice, null, /Only pay half/i);
    assertTicketCounts(inventory, 'dwarf_minecart_ticket_kelda_ice', 1);
    assert.equal(inventory.getItemCount(coinsId), 0, 'ineligible Charos rings pay full fare');
  });
}

// UNKNOWN engineering track placements; assert the native map rows and dispatch each fixed track directly.
check('native train cart placements encode Track 1 Ice and Track 4 White Wolf without a cart destination menu', () => {
  const cityRows = nativeLocRows('keldagrim_train_cart');
  assert.equal(cityRows.length, 2, 'both native Keldagrim train carts are present');
  const byX = [...cityRows].sort((left, right) => left.x - right.x);
  assert.deepEqual(byX.map(row => row.coord), ['0_45_159_39_3', '0_45_159_52_4']);
  assert.deepEqual(byX.map(row => [row.level, row.x, row.z]), [[0, 2919, 10179], [0, 2932, 10180]]);
  for (const name of ['icemountain_train_cart', 'whitewolfmountain_train_cart']) {
    assert.ok(nativeLocRows(name).length > 0, `native return cart placement exists: ${name}`);
  }
});

const westCart = nativeLocRows('keldagrim_train_cart').find(row => row.x === 2919);
const eastCart = nativeLocRows('keldagrim_train_cart').find(row => row.x === 2932);
const iceReturnCarts = nativeLocRows('icemountain_train_cart');
const wolfReturnCarts = nativeLocRows('whitewolfmountain_train_cart');

check('Keldagrim Track 1 consumes one Ice ticket and lands at Ice Mountain without gold', () => {
  rideCart(westCart, 'dwarf_minecart_ticket_kelda_ice', [0, 2994, 9845], { count: 2, fishing: false });
});

check('Keldagrim Track 4 consumes one White Wolf ticket and lands at White Wolf Mountain', () => {
  rideCart(eastCart, 'dwarf_minecart_ticket_kelda_whitewolf', [0, 2874, 9873], { count: 2, fishing: true });
});

check('Ice Mountain cart consumes one return ticket and lands at the Keldagrim train exit without Fishing', () => {
  rideCart(iceReturnCarts[0], 'dwarf_minecart_ticket_ice_kelda', [0, 2927, 10180], { count: 2, fishing: false });
});

check('White Wolf Mountain cart consumes one return ticket and lands at the Keldagrim train exit', () => {
  rideCart(wolfReturnCarts[0], 'dwarf_minecart_ticket_whitewolf_kelda', [0, 2927, 10180], { count: 2, fishing: true });
});

for (const [row, wrongTicket, label] of [
  [westCart, 'dwarf_minecart_ticket_kelda_whitewolf', 'Ice track rejects White Wolf outbound ticket'],
  [eastCart, 'dwarf_minecart_ticket_kelda_ice', 'White Wolf track rejects Ice outbound ticket'],
  [iceReturnCarts[0], 'dwarf_minecart_ticket_whitewolf_kelda', 'Ice return cart rejects White Wolf return ticket'],
  [wolfReturnCarts[0], 'dwarf_minecart_ticket_ice_kelda', 'White Wolf return cart rejects Ice return ticket']
]) {
  check(label, () => {
    refuseCart(row, wrongTicket, { fishing: row === eastCart || row === wolfReturnCarts[0] });
  });
}

check('train cart refuses an attempt with no ticket', () => {
  const player = refuseCart(westCart, null);
  assertTicketCounts(bag(player));
});


check('all train ticket purchases and rides require Giant Dwarf entry', () => {
  const citySeller = conductorRows.get(1)[0];
  const seller = playerAt([citySeller.level, citySeller.x, citySeller.z]);
  setGiantDwarfStage(seller, 0);
  setFishingComplete(seller, true);
  const sellerInventory = bag(seller);
  addCoins(seller, 150);
  const { npc, selected } = dispatchNpc(seller, citySeller);
  runSelectedInteraction(seller, selected, npc, [buyStationChoice], leaveStationChoice);
  assertTicketCounts(sellerInventory);
  assert.equal(sellerInventory.getItemCount(coinsId), 150);

  const wolfSeller = conductorRows.get(6)[0];
  const lockedWolfSeller = playerAt([wolfSeller.level, wolfSeller.x, wolfSeller.z]);
  setGiantDwarfStage(lockedWolfSeller, 0);
  setFishingComplete(lockedWolfSeller, true);
  const lockedWolfInventory = bag(lockedWolfSeller);
  addCoins(lockedWolfSeller, 100);
  const lockedWolfDispatch = dispatchNpc(lockedWolfSeller, wolfSeller);
  runSelectedInteraction(lockedWolfSeller, lockedWolfDispatch.selected, lockedWolfDispatch.npc, [
    buyStationChoice
  ], leaveStationChoice);
  assertTicketCounts(lockedWolfInventory);
  assert.equal(lockedWolfInventory.getItemCount(coinsId), 100, 'Giant Dwarf gate applies to the White Wolf return seller');

  const outbound = playerAt(adjacentLocTile(westCart));
  setGiantDwarfStage(outbound, 0);
  setFishingComplete(outbound, false);
  const outboundInventory = bag(outbound);
  outboundInventory.add(ticketId('dwarf_minecart_ticket_kelda_ice'), 1);
  const outboundStart = tileOf(outbound);
  const outboundVars = variableSnapshot(outbound);
  const outboundLoc = locFor(westCart);
  outbound.target = outboundLoc;
  outbound.targetOp = ServerTriggerType.OPLOC1 - 7;
  const outboundTrigger = outbound.getOpTrigger();
  assert.equal(outboundTrigger?.name, '[oploc1,keldagrim_train_cart]');
  const outboundResult = runSelectedInteraction(outbound, outboundTrigger, outboundLoc);
  assert.deepEqual(outboundResult.menus, []);
  assert.deepEqual(tileOf(outbound), outboundStart);
  assert.equal(outboundInventory.getItemCount(ticketId('dwarf_minecart_ticket_kelda_ice')), 1);
  assert.deepEqual(variableSnapshot(outbound), outboundVars);

  const returner = playerAt(adjacentLocTile(iceReturnCarts[0]));
  setGiantDwarfStage(returner, 0);
  setFishingComplete(returner, false);
  const returnInventory = bag(returner);
  returnInventory.add(ticketId('dwarf_minecart_ticket_ice_kelda'), 1);
  const returnStart = tileOf(returner);
  const returnVars = variableSnapshot(returner);
  const returnLoc = locFor(iceReturnCarts[0]);
  returner.target = returnLoc;
  returner.targetOp = ServerTriggerType.OPLOC1 - 7;
  const returnTrigger = returner.getOpTrigger();
  assert.equal(returnTrigger?.name, '[oploc1,icemountain_train_cart]');
  const returnResult = runSelectedInteraction(returner, returnTrigger, returnLoc);
  assert.deepEqual(returnResult.menus, []);
  assert.deepEqual(tileOf(returner), returnStart);
  assert.equal(returnInventory.getItemCount(ticketId('dwarf_minecart_ticket_ice_kelda')), 1);
  assert.deepEqual(variableSnapshot(returner), returnVars);
});

check('White Wolf outbound and return travel both require Fishing completion', () => {
  refuseCart(eastCart, 'dwarf_minecart_ticket_kelda_whitewolf', { fishing: false });
  refuseCart(wolfReturnCarts[0], 'dwarf_minecart_ticket_whitewolf_kelda', { fishing: false });
});

function boatTalk(row, stage, yes, start = [row.level, row.x, row.z]) {
  const player = playerAt(start);
  setGiantDwarfStage(player, stage);
  setFishingComplete(player, false);
  const inventory = bag(player);
  addCoins(player, 23);
  const before = tileOf(player);
  const { npc, selected } = dispatchNpc(player, row);
  const choice = yes
    ? /Yes, please take me\./i
    : /No way|No thanks/i;
  const result = runSelectedInteraction(player, selected, npc, [choice]);
  assert.equal(inventory.getItemCount(coinsId), 23, 'boat travel is free');
  return { player, before, result };
}

check('mines boat prequest remains the original dispatched intro; only the >=1 repeat branch is exercised', () => {
  const row = findNpcRow('dwarf_city_boatman_mines_prequest');
  const player = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(player, 0);
  const { selected } = dispatchNpc(player, row);
  assert.equal(selected.name, '[opnpc1,dwarf_city_boatman_mines_prequest]');
  // Deliberately do not run the initial voyage; it belongs to the Giant Dwarf intro.
});

for (const stage of [1, 2]) {
  check(`mines boatman repeat at Giant Dwarf value ${stage} returns to the city dock on consent`, () => {
    const row = findNpcRow('dwarf_city_boatman_mines_prequest');
    const { player, result } = boatTalk(row, stage, true);
    assert.deepEqual(tileOf(player), [0, 2888, 10227]);
    assert.ok(
      result.menus.some(options => options.some(label => /Yes, please take me\./i.test(label))),
      'repeat branch presents the consent menu'
    );
    assertLanding([0, 2888, 10227], 'mines boat return');
  });
}

check('mines boatman repeat cancellation keeps the player at the mines and takes no fare', () => {
  const row = findNpcRow('dwarf_city_boatman_mines_prequest');
  const { player, before } = boatTalk(row, 1, false);
  assert.deepEqual(tileOf(player), before);
});

check('city boatman free consent returns to the mines without a city access gate', () => {
  const row = findNpcRow('dwarf_city_boatman_city');
  const { player } = boatTalk(row, 1, true, [0, 2888, 10227]);
  assert.deepEqual(tileOf(player), [0, 2842, 10129]);
  assertLanding([0, 2842, 10129], 'city boat return');
});

check('city boatman cancellation keeps the player at the city dock', () => {
  const row = findNpcRow('dwarf_city_boatman_city');
  const { player, before } = boatTalk(row, 1, false, [0, 2888, 10227]);
  assert.deepEqual(tileOf(player), before);
});

function ferryTalk(name, coins, choice, stage = 0) {
  const row = findNpcRow(name);
  const player = playerAt([row.level, row.x, row.z]);
  setGiantDwarfStage(player, stage);
  setFishingComplete(player, false);
  const inventory = bag(player);
  addCoins(player, coins);
  const before = tileOf(player);
  const { npc, selected } = dispatchNpc(player, row);
  const result = runSelectedInteraction(player, selected, npc, [choice]);
  return { player, inventory, before, result };
}

check('south ferryman exposes and handles the downstream dialogue option without taking fare', () => {
  const { player, inventory, before } = ferryTalk(
    'dwarfrock_ferryman1', 2, /go further downstream/i, 0
  );
  assert.deepEqual(tileOf(player), before, 'downstream suggestion does not falsely teleport');
  assert.equal(inventory.getItemCount(coinsId), 2, 'downstream dialogue takes no fare');
  assert.match(tileText(player), /friend here|goes to the city/i, 'the ferry option points the player to the boatman');
});

check('south ferry charges exactly two coins, refuses a one-coin shortfall and allows cancellation without quest gates', () => {
  const success = ferryTalk('dwarfrock_ferryman1', 2, /Yes please\./i, 0);
  assert.deepEqual(tileOf(success.player), [0, 2855, 10144]);
  assert.equal(success.inventory.getItemCount(coinsId), 0);
  assertLanding([0, 2855, 10144], 'south ferry landing');

  const short = ferryTalk('dwarfrock_ferryman1', 1, /Yes please\./i, 0);
  assert.deepEqual(tileOf(short.player), short.before);
  assert.equal(short.inventory.getItemCount(coinsId), 1, 'south ferry refuses under two coins without taking the remainder');

  const cancelled = ferryTalk('dwarfrock_ferryman1', 2, /No thanks\./i, 0);
  assert.deepEqual(tileOf(cancelled.player), cancelled.before);
  assert.equal(cancelled.inventory.getItemCount(coinsId), 2, 'declining the south ferry costs nothing');
});

check('north ferry charges two coins normally, but the 2023 return exception waives and retains one coin', () => {
  const success = ferryTalk('dwarfrock_ferryman2', 2, /Yes please\./i, 0);
  assert.deepEqual(tileOf(success.player), [0, 2839, 10128]);
  assert.equal(success.inventory.getItemCount(coinsId), 0);
  assertLanding([0, 2839, 10128], 'north ferry landing');

  const waived = ferryTalk('dwarfrock_ferryman2', 1, /Yes please\./i, 0);
  assert.deepEqual(tileOf(waived.player), [0, 2839, 10128]);
  assert.equal(waived.inventory.getItemCount(coinsId), 1, 'unaffordable return trip waives fare and preserves the single coin');
  assertLanding([0, 2839, 10128], 'waived north ferry landing');

  const cancelled = ferryTalk('dwarfrock_ferryman2', 2, /No thanks\./i, 0);
  assert.deepEqual(tileOf(cancelled.player), cancelled.before);
  assert.equal(cancelled.inventory.getItemCount(coinsId), 2);
});

console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} dwarven-transport: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL DETAIL ${failure.name}: ${failure.message}`);
}
// The shared map runtime owns worker threads; follow the other compiled tests'
// explicit shutdown rather than leaving a completed fixture process alive.
process.exit(failures.length ? 1 : 0);
