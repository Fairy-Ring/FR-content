import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BlockWalk, EntityLifeCycle, floorTiles, IfSetText, InvButton, InvButtonHandler, MessageGame, Npc,
  Player, PlayerStatMap, ResumePauseButton, ResumePauseButtonHandler, ScriptProvider, ScriptRunner,
  ScriptState, ServerTriggerType, World, content, locFor, map, nativeLocRows, nativeNpcRows, packed,
  reachable, requiredId, sourceMapCount, tileFromCoord, tileOf, types, walkable
} from './runtime.mjs';

const auditTriggers = [
  '[opnpc1,caveguide6]',
  '[opnpc1,elf_city_guard]',
  '[label,prif_guard_halt]',
  '[oploc1,elf_city_gate_left]',
  '[oploc1,elf_city_gate_right]',
  '[opheld1,regicide_quest_kings_summons]',
  '[oploc1,regicide_voyage_temple_well1]',
  '[oploc1,regicide_voyage_temple_well2]',
  '[oploc1,regicide_voyage_temple_entrance]',
  '[oploc1,regicide_voyage_temple_exit]',
  '[oploc1,regicide_trap_hand_holds]',
  '[oploc1,regicide_logbalance1_start]',
  '[oploc1,regicide_logbalance2_start]',
  '[oploc1,regicide_logbalance3_start]',
  '[label,regicide_logbalance]',
  '[oploc1,regicide_tent_door]',
  '[oploc1,overpass_gate_left]',
  '[oploc1,overpass_gate_right]',
  '[label,arandar_gate]',
  '[opnpc1,regicide_general_hining]',
  '[opnpc1,regicidegeneralshopkeeper]'
];
const notBuiltTriggers = new Set([
  '[label,prif_guard_halt]',
  '[oploc1,elf_city_gate_left]',
  '[oploc1,elf_city_gate_right]'
]);
const builtTriggers = auditTriggers.filter(name => !notBuiltTriggers.has(name));
const failures = [];
let passed = 0;
let playerSerial = 0;
const packetLog = new WeakMap();
const pauseHandler = new ResumePauseButtonHandler();
const inventoryButtonHandler = new InvButtonHandler();
const inventoryId = requiredId(types.InvType, 'inv');
const agility = PlayerStatMap.get('AGILITY');
assert.ok(Number.isInteger(agility), 'Agility stat is loaded');

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

function constant(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const file of [
    `${content}/scripts/quests/quest_regicide/configs/quest_regicide.constant`,
    `${content}/scripts/general/configs/quest.constant`
  ]) {
    const source = readFileSync(file, 'utf8');
    const match = new RegExp(`^\\^${escaped}\\s*=\\s*(-?\\d+)\\s*$`, 'm').exec(source);
    if (match) return Number(match[1]);
  }
  assert.fail(`missing published quest constant ${name}`);
}

function varp(player, name, value) {
  const id = requiredId(types.VarPlayerType, name);
  if (value !== undefined) player.setVar(id, value);
  return player.getVar(id);
}

function setBit(player, name, enabled) {
  const index = constant(name);
  const mask = 1 << index;
  const old = varp(player, 'regicide_bits');
  varp(player, 'regicide_bits', enabled ? old | mask : old & ~mask);
}

function bit(player, name) {
  return (varp(player, 'regicide_bits') >>> constant(name)) & 1;
}

function componentId(name) {
  return requiredId(types.Component, name);
}

function playerAt(tile) {
  const slot = ++playerSerial;
  const player = new Player(`regicide_test_${slot}`, BigInt(slot), 0n);
  player.slot = slot;
  player.pid = slot;
  player.uid = ((Number(player.username37 & 0x1fffffn) << 11) | slot) >>> 0;
  player.vars.fill(0);
  player.baseLevels.fill(99);
  player.levels.fill(99);
  [player.level, player.x, player.z] = tile;
  player.buildArea.originX = Math.floor(tile[1] / 8) * 8;
  player.buildArea.originZ = Math.floor(tile[2] / 8) * 8;
  World.players[slot] = player;
  const packets = [];
  packetLog.set(player, packets);
  player.write = message => packets.push(message);
  return player;
}

function text(player) {
  return packetLog.get(player)
    .filter(message => message instanceof IfSetText || message instanceof MessageGame)
    .map(message => message instanceof MessageGame ? message.msg : message.text)
    .join('\n').replace(/\s+/g, ' ');
}

function componentTexts(player) {
  return packetLog.get(player)
    .filter(message => message instanceof IfSetText)
    .map(message => [message.component, message.text]);
}

function clearPackets(player) {
  packetLog.get(player).length = 0;
}

function startScript(player, script, target = null) {
  const state = ScriptRunner.init(script, player, target);
  player.executeScript(state, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} aborts on entry`);
  return state;
}

function resumeMessage(player, state) {
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'expected a Continue pause');
  assert.ok(pauseHandler.handle(new ResumePauseButton(0), player), 'production Continue handler accepts the pause');
  assert.notEqual(state.execution, ScriptState.ABORTED, 'script remains live after Continue');
}

function choose(player, state, index) {
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'expected a choice pause');
  const component = componentId(`multi2:com_${index + 1}`);
  player.lastCom = component;
  assert.ok(pauseHandler.handle(new ResumePauseButton(component), player), 'production choice handler accepts the choice');
  assert.notEqual(state.execution, ScriptState.ABORTED, 'script remains live after choosing');
}

function finish(player, state, choices = [], defaultChoice = null) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 100; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script?.name ?? 'script'} aborts`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      if (player.modalChat === componentId('multi2')) {
        const choice = choices.length ? choices.shift() : defaultChoice;
        assert.notEqual(choice, null, 'unexpected interactive choice');
        choose(player, state, choice);
      } else {
        resumeMessage(player, state);
      }
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
      player.delayed = false;
      player.executeScript(state, true, true);
    } else {
      assert.fail(`unexpected script suspension ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'packed script finishes within 100 offline steps');
  assert.equal(player.delayed, false, 'script delay has settled');
  assert.equal(choices.length, 0, 'all requested choices were consumed');
}

function runPacked(player, name, target = null, choices = [], selected = null, defaultChoice = null) {
  const script = selected ?? packed(name);
  const stageBefore = varp(player, 'regicide_quest');
  const state = startScript(player, script, target);
  finish(player, state, choices, defaultChoice);
  assert.equal(varp(player, 'regicide_quest'), stageBefore, `${name} never advances the Regicide stage`);
  return state;
}

function startNpcTalk(player, npc, name, choices = [], defaultChoice = null) {
  player.target = npc;
  player.targetOp = ServerTriggerType.OPNPC1 - 7;
  const selected = player.getOpTrigger();
  assert.ok(selected, `production NPC dispatch misses ${name}`);
  assert.equal(selected.name, name, 'Talk-to dispatch selects the exact packed trigger');
  return runPacked(player, name, npc, choices, selected, defaultChoice);
}

function startLoc(player, row, name, choices = []) {
  const loc = locFor(row);
  return runPacked(player, name, loc, choices);
}

function settleLocChanges(row) {
  // The offline runner resumes scripts, not world cycles. Expire temporary door/gate forms
  // through the production lifecycle before the next approach uses the native placement.
  const locs = [...World.gameMap.getZone(row.x, row.z, row.level).getAllLocsUnsafe()];
  for (const loc of locs) {
    while (loc.lifecycleTick > 0) loc.turn();
  }
}

function allCandidateTiles(row, radius = 6) {
  const result = [];
  for (let x = row.x - radius; x <= row.x + radius; x++) {
    for (let z = row.z - radius; z <= row.z + radius; z++) {
      if (Math.max(Math.abs(x - row.x), Math.abs(z - row.z)) > radius) continue;
      const tile = [row.level, x, z];
      if (!floorTiles.has(tile.join(',')) || map.isMapBlocked(x, z, row.level)) continue;
      if (reachable(tile, row)) result.push(tile);
    }
  }
  result.sort((a, b) => Math.abs(a[1] - row.x) + Math.abs(a[2] - row.z) - Math.abs(b[1] - row.x) - Math.abs(b[2] - row.z) || a[1] - b[1] || a[2] - b[2]);
  return result;
}

function approach(row) {
  const candidates = allCandidateTiles(row);
  assert.ok(candidates.length, `walkable native approach required: ${row.name} ${row.coord}`);
  return candidates[0];
}

function approachOnSide(row, axis, side, aligned = false) {
  const index = axis === 'x' ? 1 : 2;
  const alignedIndex = axis === 'x' ? 2 : 1;
  const coordinate = row[axis === 'x' ? 'x' : 'z'];
  const alignedCoordinate = row[axis === 'x' ? 'z' : 'x'];
  const candidates = allCandidateTiles(row, 8).filter(tile =>
    Math.sign(tile[index] - coordinate) === side && (!aligned || tile[alignedIndex] === alignedCoordinate)
  );
  assert.ok(candidates.length, `${row.name} ${row.coord}: native ${axis}-axis approach on side ${side}`);
  return candidates[0];
}

function inZone(tile, zone) {
  return tile[0] === zone.level && tile[1] >= zone.minX && tile[1] <= zone.maxX && tile[2] >= zone.minZ && tile[2] <= zone.maxZ;
}

function nativeNpc(name, index = 0) {
  const rows = nativeNpcRows(name);
  assert.ok(rows.length > index, `native map spawn required: ${name}`);
  return rows[index];
}

const spawnedNpcs = new Map();
function spawnNpc(row) {
  const key = `${row.name}@${row.coord}`;
  if (spawnedNpcs.has(key)) return spawnedNpcs.get(key);
  const type = types.NpcType.get(requiredId(types.NpcType, row.name));
  const nid = World.npcs.next();
  const npc = new Npc(row.level, row.x, row.z, type.size, type.size, EntityLifeCycle.RESPAWN, nid, type.id, BlockWalk.NONE);
  npc.lastMovement = -100;
  World.addNpc(npc, -1);
  spawnedNpcs.set(key, npc);
  return npc;
}


function firstNativeLoc(name) {
  const rows = nativeLocRows(name);
  assert.ok(rows.length, `native map placement required: ${name}`);
  return rows[0];
}

function assertStageUnchanged(player, before, label) {
  assert.equal(varp(player, 'regicide_quest'), before, `${label} does not write the quest stage`);
}


check('audit rank-nine baseline retains 21 exact IDs and classifies three unbuilt Prif triggers', () => {
  assert.equal(auditTriggers.length, 21);
  assert.equal(builtTriggers.length, 18);
  assert.equal(notBuiltTriggers.size, 3);
  assert.ok(sourceMapCount > 0, 'native 377 source maps are present');
  for (const name of builtTriggers) assert.ok(ScriptProvider.getByName(name), `packed trigger ${name}`);
  for (const name of notBuiltTriggers) assert.equal(ScriptProvider.getByName(name), undefined, `${name} remains unbuilt without a native Prif gate form`);
  for (const name of ['elf_city_gate_left', 'elf_city_gate_right']) {
    assert.equal(nativeLocRows(name).length, 0, `${name} has no native map placement`);
    const type = types.LocType.get(requiredId(types.LocType, name));
    assert.deepEqual(type.multiloc, [], `${name} has no native multiloc parent`);
  }
  for (const name of ['crystal_wall_maindoor', 'crystal_wall_maindoorl']) {
    const type = types.LocType.get(requiredId(types.LocType, name));
    assert.deepEqual(type.op?.filter(Boolean) ?? [], [], `${name} is not an interactive gate form`);
    assert.deepEqual(type.multiloc, [], `${name} does not morph into an elf city gate form`);
  }
});

check('Prif guard Talk-to uses its real native placement and no gate trigger is fabricated', () => {
  const row = nativeNpc('elf_city_guard');
  const npc = spawnNpc(row);
  const p = playerAt(tileOf(npc));
  const stage = constant('regicide_not_started');
  varp(p, 'regicide_quest', stage);
  const before = varp(p, 'regicide_quest');
  startNpcTalk(p, npc, '[opnpc1,elf_city_guard]');
  const dialogue = text(p);
  assert.match(dialogue, /no humans may enter Prifddinas/i);
  assert.match(dialogue, /rules are rules/i);
  assertStageUnchanged(p, before, 'Prif guard Talk-to');
});

check('Koftik gives two bread and one stew once, and the outbound well bit gates his hint', () => {
  const koftik = spawnNpc(nativeNpc('caveguide6'));
  const bread = requiredId(types.ObjType, 'bread');
  const stew = requiredId(types.ObjType, 'stew');
  const p = playerAt(tileOf(koftik));
  const inv = p.getInventory(inventoryId);
  varp(p, 'regicide_quest', constant('regicide_not_started'));
  varp(p, 'regicide_bits', 1 << constant('regicide_seen_guard'));
  const firstStage = varp(p, 'regicide_quest');
  startNpcTalk(p, koftik, '[opnpc1,caveguide6]');
  assert.equal(inv.getItemCount(bread), 2);
  assert.equal(inv.getItemCount(stew), 1);
  assert.equal(bit(p, 'regicide_koftik_food'), 1);
  assert.equal(bit(p, 'regicide_seen_guard'), 1, 'Koftik food bit preserves other Regicide bits');
  assert.equal(bit(p, 'regicide_down_well'), 0);
  assert.match(text(p), /reparations to the well of voyage/i);
  assertStageUnchanged(p, firstStage, 'Koftik first Talk-to');

  const secondStage = varp(p, 'regicide_quest');
  const firstFoodCounts = [inv.getItemCount(bread), inv.getItemCount(stew)];
  startNpcTalk(p, koftik, '[opnpc1,caveguide6]');
  assert.deepEqual([inv.getItemCount(bread), inv.getItemCount(stew)], firstFoodCounts, 'repeat Talk-to gives no additional food');
  assert.equal(bit(p, 'regicide_koftik_food'), 1);
  assert.match(text(p), /Good to hear/i);
  assertStageUnchanged(p, secondStage, 'Koftik repeat Talk-to');

  const well1 = firstNativeLoc('regicide_voyage_temple_well1');
  setPlayerPosition(p, approach(well1));
  const wellStateStage = varp(p, 'regicide_quest');
  startLoc(p, well1, '[oploc1,regicide_voyage_temple_well1]');
  assert.equal(bit(p, 'regicide_down_well'), 1, 'outbound well sets bit 1');
  assert.equal(bit(p, 'regicide_seen_guard'), 1, 'outbound well preserves other Regicide bits');
  assertStageUnchanged(p, wellStateStage, 'outbound well');

  setPlayerPosition(p, tileOf(koftik));
  clearPackets(p);
  const afterWellStage = varp(p, 'regicide_quest');
  startNpcTalk(p, koftik, '[opnpc1,caveguide6]');
  assert.doesNotMatch(text(p), /reparations to the well of voyage/i, 'Koftik omits the repaired-well hint after the outbound bit');
  assert.equal(bit(p, 'regicide_koftik_food'), 1, 'the already-set food bit remains set after the well');
  assertStageUnchanged(p, afterWellStage, 'Koftik after outbound well');
});

const travelCases = [
  { name: 'regicide_voyage_temple_well1', trigger: '[oploc1,regicide_voyage_temple_well1]', destination: '0_36_150_39_22', setDownWell: true },
  { name: 'regicide_voyage_temple_well2', trigger: '[oploc1,regicide_voyage_temple_well2]', destination: '1_31_73_26_40' },
  { name: 'regicide_voyage_temple_entrance', trigger: '[oploc1,regicide_voyage_temple_entrance]', destination: '0_36_150_10_24' },
  { name: 'regicide_voyage_temple_exit', trigger: '[oploc1,regicide_voyage_temple_exit]', destination: '0_36_50_8_16' }
];
for (const travel of travelCases) {
  check(`${travel.name} uses its packed travel target and walkable donor landing`, () => {
    const rows = nativeLocRows(travel.name);
    assert.equal(rows.length, 1, `${travel.name} has its expected native placement`);
    const row = rows[0];
    const p = playerAt(approach(row));
    const expected = tileFromCoord(travel.destination);
    const beforeStage = varp(p, 'regicide_quest');
    if (travel.setDownWell) setBit(p, 'regicide_down_well', false);
    startLoc(p, row, travel.trigger);
    assert.deepEqual(tileOf(p), expected, `${travel.name} reaches ${travel.destination}`);
    walkable(expected, travel.name);
    if (travel.setDownWell) assert.equal(bit(p, 'regicide_down_well'), 1, 'the outbound well writes down-well bit 1');
    assertStageUnchanged(p, beforeStage, travel.name);
  });
}

const handholdBranches = [
  { label: 'pit side 1', from: ['0_36_150_50_56', '0_36_150_51_56'], destination: '0_35_50_27_1' },
  { label: 'pit side 2', from: ['0_36_150_50_57', '0_36_150_51_57'], destination: '0_35_50_27_5' },
  { label: 'pit side 3', from: ['0_36_150_50_43', '0_36_150_50_44'], destination: '0_35_50_35_62' },
  { label: 'pit side 4', from: ['0_36_150_51_43', '0_36_150_51_44'], destination: '0_35_50_39_62' },
  { label: 'pit side 5', from: ['0_36_150_9_56', '0_36_150_10_56'], destination: '0_34_50_33_1' },
  { label: 'pit side 6', from: ['0_36_150_9_57', '0_36_150_10_57'], destination: '0_34_50_33_5' },
  { label: 'pit side 7', from: ['0_36_150_32_56', '0_36_150_33_56'], destination: '0_35_49_34_36' },
  { label: 'pit side 8', from: ['0_36_150_32_57', '0_36_150_33_57'], destination: '0_35_49_34_40' }
].map(branch => {
  const [a, b] = branch.from.map(coord => tileFromCoord(coord));
  return {
    ...branch,
    zone: { level: a[0], minX: Math.min(a[1], b[1]), maxX: Math.max(a[1], b[1]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]) }
  };
});

check('handholds cover all eight native pit sides with no level check, XP, or failure', () => {
  const rows = nativeLocRows('regicide_trap_hand_holds');
  assert.equal(rows.length, 16, 'the packed 377 map has sixteen handhold loc tiles forming eight pit sides');
  const covered = new Set();
  for (const branch of handholdBranches) {
    const sideRows = rows.filter(row => branch.from.includes(row.coord));
    assert.equal(sideRows.length, 2, `${branch.label} has its two native map loc halves`);
    for (const row of sideRows) covered.add(row.coord);
    const candidates = sideRows.flatMap(row => allCandidateTiles(row, 3).filter(tile => inZone(tile, branch.zone)));
    candidates.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    assert.ok(candidates.length, `${branch.label} has a walkable, reachable native approach within its donor zone`);
    const start = candidates[0];
    const targetRow = sideRows.find(row => reachable(start, row));
    assert.ok(targetRow, `${branch.label} approach reaches the selected map loc`);
    const p = playerAt(start);
    setAgility(p, 1);
    assert.equal(p.baseLevels[agility], 1, `${branch.label} starts below the log-balance requirement`);
    const statsBefore = [...p.stats];
    const levelsBefore = [...p.levels];
    const baseBefore = [...p.baseLevels];
    const stageBefore = varp(p, 'regicide_quest');
    startLoc(p, targetRow, '[oploc1,regicide_trap_hand_holds]');
    const destination = tileOf(p);
    assert.deepEqual(destination, tileFromCoord(branch.destination), `${branch.label} reaches the donor endpoint`);
    walkable(destination, branch.label);
    assert.deepEqual([...p.stats], statsBefore, `${branch.label} awards no XP`);
    assert.deepEqual([...p.levels], levelsBefore, `${branch.label} changes no current skill level`);
    assert.deepEqual([...p.baseLevels], baseBefore, `${branch.label} changes no base skill level`);
    assert.doesNotMatch(text(p), /slip|fail|fall|agility level/i, `${branch.label} has no failure or level-refusal path`);
    assertStageUnchanged(p, stageBefore, branch.label);
  }
  assert.equal(covered.size, 16, 'all native handhold loc tiles belong to one of the eight branches');
});

function setAgility(player, level) {
  player.baseLevels[agility] = level;
  player.levels[agility] = level;
  player.stats[agility] = 123456;
}

const logCases = [
  { name: 'regicide_logbalance1_start', axis: 'x', ends: [[0, 2197, 3237], [0, 2201, 3237]], landings: [[0, 2202, 3237], [0, 2196, 3237]] },
  { name: 'regicide_logbalance2_start', axis: 'x', ends: [[0, 2259, 3250], [0, 2263, 3250]], landings: [[0, 2264, 3250], [0, 2258, 3250]] },
  { name: 'regicide_logbalance3_start', axis: 'z', ends: [[0, 2290, 3233], [0, 2290, 3238]], landings: [[0, 2290, 3239], [0, 2290, 3232]] }
];
for (const log of logCases) {
  check(`${log.name} enforces Agility 45, gives no XP/failure, and crosses from both sides at every placement`, () => {
    const rows = nativeLocRows(log.name);
    assert.equal(rows.length, 2, `${log.name} has two native map placements`);
    for (const row of rows) {
      const end = log.ends.findIndex(tile => tile[0] === row.level && tile[1] === row.x && tile[2] === row.z);
      assert.notEqual(end, -1, `${log.name} ${row.coord} is an expected native log end`);
      const expectedLanding = log.landings[end];
      const lowStart = approachOnSide(row, log.axis, -1);
      const low = playerAt(lowStart);
      setAgility(low, 44);
      const lowXp = [...low.stats];
      const lowStage = varp(low, 'regicide_quest');
      startLoc(low, row, `[oploc1,${log.name}]`);
      assert.deepEqual(tileOf(low), lowStart, `${log.name} refuses below level 45 without moving`);
      assert.deepEqual([...low.stats], lowXp, `${log.name} below-level refusal awards no XP`);
      assert.match(text(low), /45/i, 'the refusal cites the required level');
      assert.match(text(low), /agility/i, 'the refusal names Agility');
      assertStageUnchanged(low, lowStage, `${log.name} below-level refusal`);

      for (const side of [-1, 1]) {
        const start = approachOnSide(row, log.axis, side);
        const p = playerAt(start);
        setAgility(p, 45);
        const statsBefore = [...p.stats];
        const levelsBefore = [...p.levels];
        const baseBefore = [...p.baseLevels];
        const stageBefore = varp(p, 'regicide_quest');
        startLoc(p, row, `[oploc1,${log.name}]`);
        const destination = tileOf(p);
        assert.deepEqual(destination, expectedLanding, `${log.name} ${row.coord} approach ${side}: wrong landing, expected ${expectedLanding.join(',')}, got ${destination.join(',')}`);
        assert.notDeepEqual(destination, start, `${log.name} moves the player`);
        walkable(destination, `${log.name} ${row.coord} approach ${side}`);
        assert.deepEqual([...p.stats], statsBefore, `${log.name} awards no Agility or other XP`);
        assert.deepEqual([...p.levels], levelsBefore, `${log.name} changes no current skill level`);
        assert.deepEqual([...p.baseLevels], baseBefore, `${log.name} changes no base skill level`);
        assert.doesNotMatch(text(p), /slip|fail|fall|need.*level/i, `${log.name} has no failure on a successful crossing`);
        assertStageUnchanged(p, stageBefore, `${log.name} level-45 crossing`);
      }
    }
  });
}

check('the shared logbalance label and both log entry triggers are packed', () => {
  assert.ok(ScriptProvider.getByName('[label,regicide_logbalance]'));
  assert.ok(ScriptProvider.getByName('[oploc1,regicide_logbalance1_start]'));
  assert.ok(ScriptProvider.getByName('[oploc1,regicide_logbalance2_start]'));
});

check('tent door switches between the king-quarters and Hining-pavilion guard lines at stage 11/12', () => {
  const door = firstNativeLoc('regicide_tent_door');
  const guardRow = nativeNpc('regicide_tyras_camp_tent_guard');
  assert.equal(guardRow.level, door.level);
  assert.equal(guardRow.x, door.x - 1, 'the native tent guard stands at the exact west-side search tile');
  assert.equal(guardRow.z, door.z);
  const guard = spawnNpc(guardRow);
  for (const [stage, expected, absent] of [
    [constant('regicide_spoken_iorwerth2'), /king.s quarters/i, /general hining.s pavilion/i],
    [constant('regicide_killed_tyras'), /general hining.s pavilion/i, /king.s quarters/i]
  ]) {
    const p = playerAt(approach(door));
    varp(p, 'regicide_quest', stage);
    const before = varp(p, 'regicide_quest');
    startLoc(p, door, '[oploc1,regicide_tent_door]');
    assert.match(text(p), expected, `tent-door stage ${stage} selects the expected guard dialogue`);
    assert.doesNotMatch(text(p), absent, `tent-door stage ${stage} excludes the other branch`);
    assertStageUnchanged(p, before, 'tent door');
    assert.ok(guard.isActive, 'the map-placed guard remains present during the dialogue');
  }
});

check('open_iban_door preserves both exact stage-1 refusals without moving', () => {
  const entries = [
    ['upass_templedoor_closed_right', '_33_72_31_40'],
    ['upass_templedoor_closed_left', '_33_72_31_39']
  ].map(([name, coord]) => {
    const row = nativeLocRows(name).find(candidate => candidate.coord.endsWith(coord));
    assert.ok(row, `native entry door placement required: ${name} ${coord}`);
    return row;
  });
  const wornId = requiredId(types.InvType, 'worn');
  const zamorakTop = requiredId(types.ObjType, 'zamrobetop');
  const zamorakBottom = requiredId(types.ObjType, 'zamrobebottom');
  for (const row of entries) {
    const start = approachOnSide(row, 'x', 1, true);
    for (const wearRobes of [false, true]) {
      const player = playerAt(start);
      varp(player, 'regicide_quest', constant('regicide_received_message'));
      varp(player, 'upass', constant('upass_complete'));
      if (wearRobes) {
        const worn = player.getInventory(wornId);
        worn.add(zamorakTop, 1);
        worn.add(zamorakBottom, 1);
        assert.equal(worn.itemsFiltered.length, 2, 'only the named Zamorak top and bottom are worn');
      }
      const stageBefore = varp(player, 'regicide_quest');
      const bitsBefore = varp(player, 'regicide_bits');
      startLoc(player, row, `[oploc1,${row.name}]`);
      assert.deepEqual(tileOf(player), start, `${row.name} stage-1 refusal leaves the player in place`);
      assert.equal(
        text(player),
        wearRobes
          ? 'The temple is in ruins... ...You cannot enter.'
          : 'The door refuses to open... Only followers of Zamorak may enter.',
        `${row.name} preserves the exact ${wearRobes ? 'temple-ruins' : 'followers-of-Zamorak'} refusal text`
      );
      assertStageUnchanged(player, stageBefore, 'stage-1 door refusal');
      assert.equal(varp(player, 'regicide_bits'), bitsBefore, `${row.name} refusal does not write Regicide bits`);
    }
  }
});
check('open_iban_door stages 2 and 15 enter mapped well-room tiles through both native doors without quest writes', () => {
  const entries = [
    ['upass_templedoor_closed_right', '_33_72_31_40', '_31_73_31_40'],
    ['upass_templedoor_closed_left', '_33_72_31_39', '_31_73_31_39']
  ].map(([name, coord, roomCoord]) => {
    const row = nativeLocRows(name).find(candidate => candidate.coord.endsWith(coord));
    const roomDoor = nativeLocRows(name).find(candidate => candidate.coord.endsWith(roomCoord));
    assert.ok(row, `native entry door placement required: ${name} ${coord}`);
    assert.ok(roomDoor, `native well-room door placement required: ${name} ${roomCoord}`);
    return { row, roomDoor };
  });
  assert.ok(packed('[label,open_iban_door]'), 'the shared native door label is packed');
  for (const { row, roomDoor } of entries) {
    const start = approachOnSide(row, 'x', 1, true);
    const destination = [roomDoor.level, roomDoor.x - 1, roomDoor.z + (row.name === 'upass_templedoor_closed_left' ? 1 : 0)];
    assert.deepEqual(destination, [roomDoor.level, 2014, 4712], `${row.name} maps to the clear interior well-room tile`);
    for (const stage of [constant('regicide_spoken_lathas'), constant('regicide_complete')]) {
      const player = playerAt(start);
      const worn = player.getInventory(requiredId(types.InvType, 'worn'));
      assert.equal(worn.getItemCount(requiredId(types.ObjType, 'zamrobetop')), 0, 'no Zamorak top is worn');
      assert.equal(worn.getItemCount(requiredId(types.ObjType, 'zamrobebottom')), 0, 'no Zamorak bottom is worn');
      varp(player, 'regicide_quest', stage);
      varp(player, 'upass', constant('upass_complete'));
      const bitsBefore = varp(player, 'regicide_bits');
      startLoc(player, row, `[oploc1,${row.name}]`);
      assert.deepEqual(tileOf(player), destination, `${row.name} stage ${stage}: wrong landing, expected ${destination.join(',')}, got ${tileOf(player).join(',')}`);
      walkable(destination, `${row.name} stage ${stage} well-room landing`);
      assert.equal(text(player), 'You pull open the large doors...', `${row.name} stage ${stage} preserves the outbound door message`);
      assertStageUnchanged(player, stage, 'completed Underground Pass entry');
      assert.equal(varp(player, 'regicide_bits'), bitsBefore, `${row.name} does not write Regicide bits`);
      settleLocChanges(row);
    }
  }
});

check('open_iban_door returns from both native well-room doors to mapped temple tiles', () => {
  const returns = [
    ['upass_templedoor_closed_right', '_31_73_31_40', '_33_72_31_40'],
    ['upass_templedoor_closed_left', '_31_73_31_39', '_33_72_31_39']
  ].map(([name, roomCoord, templeCoord]) => {
    const row = nativeLocRows(name).find(candidate => candidate.coord.endsWith(roomCoord));
    const templeDoor = nativeLocRows(name).find(candidate => candidate.coord.endsWith(templeCoord));
    assert.ok(row, `native return door placement required: ${name} ${roomCoord}`);
    assert.ok(templeDoor, `native temple door placement required: ${name} ${templeCoord}`);
    return { row, templeDoor };
  });
  for (const { row, templeDoor } of returns) {
    const roomSide = [row.level, row.x - 1, row.z + (row.name === 'upass_templedoor_closed_left' ? 1 : 0)];
    assert.ok(floorTiles.has(roomSide.join(',')), `${row.name} room-side tile has a map floor`);
    if (row.name === 'upass_templedoor_closed_left') {
      assert.equal(map.isMapBlocked(roomSide[1], roomSide[2], roomSide[0]), false, 'the paired left-entry offset lands clear of rockslide3_upass');
      assert.equal(reachable(roomSide, row), false, 'the left return door is not reached by real loc interaction geometry');
      const westApproaches = allCandidateTiles(row, 8).filter(tile => tile[1] < row.x && tile[2] === roomSide[2]);
      assert.equal(westApproaches.length, 0, 'no collision-free west-side path reaches the left return door');
    } else {
      assert.ok(reachable(roomSide, row), 'right return door is reachable from its room-side tile');
      const westApproaches = allCandidateTiles(row, 8).filter(tile => tile[1] < row.x && tile[2] === roomSide[2]);
      assert.ok(westApproaches.some(tile => tile[1] === roomSide[1]), 'right return door has a collision-free west-side path');
      walkable(roomSide, `${row.name} room-side approach`);
    }
    const player = playerAt(roomSide);
    const destination = [templeDoor.level, templeDoor.x + 2, templeDoor.z];
    varp(player, 'regicide_quest', constant('regicide_spoken_lathas'));
    varp(player, 'upass', constant('upass_complete'));
    const stageBefore = varp(player, 'regicide_quest');
    const bitsBefore = varp(player, 'regicide_bits');
    // Left return is a direct packed invocation, not a claim of reachable native dispatch.
    startLoc(player, row, `[oploc1,${row.name}]`);
    assert.deepEqual(tileOf(player), destination, `${row.name} return lands using the native row and paired remap`);
    walkable(destination, `${row.name} temple-side return landing`);
    assert.equal(text(player), 'You pull open the large doors. ...And walk out of the temple.', `${row.name} preserves the return messages`);
    assertStageUnchanged(player, stageBefore, 'completed Underground Pass return');
    assert.equal(varp(player, 'regicide_bits'), bitsBefore, `${row.name} return does not write Regicide bits`);
  }
});


check('General Hining changes his Talk-to lines only after stage 11', () => {
  const hining = spawnNpc(nativeNpc('regicide_general_hining'));
  for (const [stage, expected, absent] of [
    [constant('regicide_spoken_iorwerth2'), /general of what.s left of this army/i, /coming darkness/i],
    [constant('regicide_killed_tyras'), /coming darkness/i, /general of what.s left of this army/i]
  ]) {
    const p = playerAt(tileOf(hining));
    varp(p, 'regicide_quest', stage);
    const before = varp(p, 'regicide_quest');
    startNpcTalk(p, hining, '[opnpc1,regicide_general_hining]');
    assert.match(text(p), expected, `Hining stage ${stage} selects the expected dialogue`);
    assert.doesNotMatch(text(p), absent, `Hining stage ${stage} excludes the other branch`);
    assertStageUnchanged(p, before, 'General Hining Talk-to');
  }
});

function setPlayerPosition(player, tile) {
  [player.level, player.x, player.z] = tile;
  player.buildArea.originX = Math.floor(tile[1] / 8) * 8;
  player.buildArea.originZ = Math.floor(tile[2] / 8) * 8;
}

check('Arandar gate rejects stage 12 north and lands exactly through both leaves in both directions and columns', () => {
  const gates = [
    { name: 'overpass_gate_left', columns: [2384, 2385], landingX: 2385 },
    { name: 'overpass_gate_right', columns: [2386, 2387], landingX: 2386 }
  ];
  const guards = nativeNpcRows('elf_overpass_guard').map(spawnNpc);
  assert.equal(guards.length, 2, 'both native overpass guards are present');

  for (const gate of gates) {
    assert.equal(nativeLocRows(gate.name).length, 1);
    const row = firstNativeLoc(gate.name);
    assert.deepEqual([row.level, row.x, row.z], [0, gate.columns[0], 3334], `${gate.name} has the expected native closed placement`);
    for (const x of gate.columns) {
      for (const direction of [
        { z: 3335, landingZ: 3333, stages: ['regicide_killed_tyras', 'regicide_reported_iorwerth'] },
        { z: 3333, landingZ: 3335, stages: ['regicide_not_started'] }
      ]) {
        const start = [row.level, x, direction.z];
        walkable(start, `${gate.name} approach`);
        assert.ok(reachable(start, row), `${gate.name} is reachable from ${start.join(',')}`);
        for (const stageName of direction.stages) {
          const p = playerAt(start);
          const stage = constant(stageName);
          varp(p, 'regicide_quest', stage);
          startLoc(p, row, `[oploc1,${row.name}]`);
          if (stageName === 'regicide_killed_tyras') {
            assert.deepEqual(tileOf(p), start, `${row.name} stays closed at exactly stage 12 from the north`);
            assert.match(text(p), /no human/i);
            assert.match(text(p), /proper documentation/i);
          } else {
            const destination = [row.level, gate.landingX, direction.landingZ];
            const actual = tileOf(p);
            assert.deepEqual(actual, destination, `${row.name} stage ${stage} from ${start.join(',')}: wrong landing, expected ${destination.join(',')}, got ${actual.join(',')}`);
            walkable(actual, `${row.name} stage ${stage} landing`);
          }
          assertStageUnchanged(p, stage, `${row.name} stage ${stage}`);
          settleLocChanges(row);
        }
      }
    }
  }
});

check('king summons Read opens the packed 377 scroll interface with the letter text', () => {
  const spawn = nativeNpc('caveguide6');
  const p = playerAt([spawn.level, spawn.x, spawn.z]);
  const summons = requiredId(types.ObjType, 'regicide_quest_kings_summons');
  const inv = p.getInventory(inventoryId);
  inv.add(summons, 1);
  p.lastItem = summons;
  p.lastSlot = inv.getItemIndex(summons);
  const stage = varp(p, 'regicide_quest');
  runPacked(p, '[opheld1,regicide_quest_kings_summons]');
  assert.equal(p.modalMain, componentId('scroll'), 'the 377 scroll interface opens');
  const components = componentTexts(p);
  const scrollComponents = new Set(Array.from({ length: 12 }, (_, index) => componentId(`scroll:com_${index + 2}`)));
  assert.ok(components.length >= 5, 'scroll contents are set through packed interface components');
  for (const [component] of components) assert.ok(scrollComponents.has(component), 'scroll text uses the published scroll component family');
  const letter = components.map(([, value]) => value).join('\n');
  assert.match(letter, /Squire /i);
  assert.match(letter, /Kingdom of/i);
  assert.match(letter, /Kandarin/i);
  assert.match(letter, /reopened\s+the well of voyage/i);
  assert.match(letter, /next commission/i);
  assert.match(letter, /King Lathas/i);
  assertStageUnchanged(p, stage, 'king summons Read');
});

function openShop(player, shopName, title) {
  const main = componentId('shop_template');
  const side = componentId('shop_template_side');
  assert.equal(player.modalMain, main, `${shopName} opens the published shop main interface`);
  assert.equal(player.modalSide, side, `${shopName} opens the published player inventory interface`);
  assert.ok(text(player).includes(title), `${shopName} uses the packed NPC shop title`);
  const shopType = requiredId(types.InvType, shopName);
  const shopCom = componentId('shop_template:inv');
  const playerCom = componentId('shop_template_side:inv');
  const shopListener = player.invListeners.find(listener => listener.type === shopType && listener.com === shopCom);
  const playerListener = player.invListeners.find(listener => listener.type === inventoryId && listener.com === playerCom);
  assert.ok(shopListener && playerListener, `${shopName} transmits the shop and player inventories`);
  const shopInv = player.getInventoryFromListener(shopListener);
  const playerInv = player.getInventoryFromListener(playerListener);
  assert.ok(shopInv && playerInv, `${shopName} listeners resolve to real inventories`);
  return { shopInv, playerInv, shopCom };
}

function optionIndex(componentName, pattern) {
  const component = types.Component.get(componentId(componentName));
  const index = (component.iop ?? []).findIndex(option => typeof option === 'string' && pattern.test(option));
  assert.ok(index >= 0, `${componentName} lacks option ${pattern}`);
  return index + 1;
}

function useInventoryButton(player, operation, obj, slot, component) {
  assert.ok(inventoryButtonHandler.handle(new InvButton(operation, obj, slot, component), player), `production inventory action ${operation} is accepted`);
}

function shopTalk(questStage) {
  const npc = spawnNpc(nativeNpc('regicidegeneralshopkeeper'));
  const p = playerAt(tileOf(npc));
  varp(p, 'regicide_quest', questStage);
  const stage = varp(p, 'regicide_quest');
  startNpcTalk(p, npc, '[opnpc1,regicidegeneralshopkeeper]', [], 0);
  return { p, stage };
}

check('quartermaster Talk-to opens parameterized base zero stock before completion and production buy refuses it', () => {
  const npcType = types.NpcType.getByName('regicidegeneralshopkeeper');
  assert.ok(npcType, 'quartermaster NPC config is packed');
  assert.deepEqual(npcType.op?.filter(Boolean) ?? [], ['Talk-to'], 'quartermaster has only its native Talk-to option');
  assert.equal(npcType.category, requiredId(types.CategoryType, 'shop_keeper'), 'shop_keeper category remains unchanged');
  assert.equal(ScriptProvider.getByName('[opnpc3,regicidegeneralshopkeeper]'), undefined, 'no quest-local Trade trigger is added');

  const params = {
    ownedShop: requiredId(types.ParamType, 'owned_shop'),
    title: requiredId(types.ParamType, 'shop_title'),
    buy: requiredId(types.ParamType, 'shop_buy_multiplier'),
    sell: requiredId(types.ParamType, 'shop_sell_multiplier'),
    delta: requiredId(types.ParamType, 'shop_delta')
  };
  const baseShop = 'regicide_general_shop';
  const completedShop = 'regicide_general_shop_2';
  const title = npcType.params.get(params.title);
  const buy = npcType.params.get(params.buy);
  const sell = npcType.params.get(params.sell);
  const delta = npcType.params.get(params.delta);
  assert.equal(typeof title, 'string');
  assert.equal(npcType.params.get(params.ownedShop), requiredId(types.InvType, baseShop), 'NPC owns the published base stock');
  assert.equal(typeof buy, 'number');
  assert.equal(typeof sell, 'number');
  assert.equal(typeof delta, 'number');

  const halberd = requiredId(types.ObjType, 'dragon_halberd');
  const baseType = types.InvType.get(requiredId(types.InvType, baseShop));
  const baseStockIndex = Array.from(baseType.stockobj ?? []).indexOf(halberd);
  assert.ok(baseStockIndex >= 0, 'the zero-stock halberd row remains visible in the base stock definition');
  assert.equal(baseType.stockcount[baseStockIndex], 0, 'the base stock row stays at zero');

  const { p, stage } = shopTalk(constant('regicide_spoken_arianwyn'));
  const before = openShop(p, baseShop, title);
  assert.equal(varp(p, 'shop'), requiredId(types.InvType, baseShop));
  assert.equal(varp(p, 'shop_buy'), buy);
  assert.equal(varp(p, 'shop_sell'), sell);
  assert.equal(varp(p, 'shop_haggle'), delta);
  assert.equal(before.shopInv.getItemCount(halberd), 0, 'base shop presents the halberd as out of stock');
  const slot = before.shopInv.getItemIndex(halberd);
  assert.ok(slot >= 0, 'zero-stock halberd slot is still represented to the shop UI');
  const coins = requiredId(types.ObjType, 'coins');
  before.playerInv.add(coins, 1000000);
  const coinsBefore = before.playerInv.getItemCount(coins);
  const itemsBefore = before.playerInv.getItemCount(halberd);
  useInventoryButton(p, optionIndex('shop_template:inv', /buy[^\d]*1\b/i), halberd, slot, before.shopCom);
  assert.equal(before.shopInv.getItemCount(halberd), 0, 'packed shop buy leaves zero stock unchanged');
  assert.equal(before.playerInv.getItemCount(halberd), itemsBefore, 'out-of-stock buy transfers no halberd');
  assert.equal(before.playerInv.getItemCount(coins), coinsBefore, 'out-of-stock buy charges no coins');
  assert.match(text(p), /out of stock/i, 'the published out-of-stock branch sends its existing refusal');
  assertStageUnchanged(p, stage, 'quartermaster base-stock opening and refusal');

  const afterNpc = spawnNpc(nativeNpc('regicidegeneralshopkeeper'));
  const after = playerAt(tileOf(afterNpc));
  varp(after, 'regicide_quest', constant('regicide_complete'));
  const afterStage = varp(after, 'regicide_quest');
  startNpcTalk(after, afterNpc, '[opnpc1,regicidegeneralshopkeeper]', [], 0);
  const completed = openShop(after, completedShop, title);
  assert.equal(varp(after, 'shop'), requiredId(types.InvType, completedShop), 'only completed stage selects the second stock');
  assert.equal(varp(after, 'shop_buy'), buy);
  assert.equal(varp(after, 'shop_sell'), sell);
  assert.equal(varp(after, 'shop_haggle'), delta);
  assert.equal(completed.shopInv.getItemCount(halberd), 5, 'completed stock has five dragon halberds');
  assertStageUnchanged(after, afterStage, 'quartermaster completed-stock opening');
});

check('quartermaster stock and published params remain readable directly from packed configs', () => {
  const type = types.NpcType.getByName('regicidegeneralshopkeeper');
  const base = types.InvType.get(requiredId(types.InvType, 'regicide_general_shop'));
  const after = types.InvType.get(requiredId(types.InvType, 'regicide_general_shop_2'));
  const halberd = requiredId(types.ObjType, 'dragon_halberd');
  const count = (inventory, item) => {
    const index = Array.from(inventory.stockobj ?? []).indexOf(item);
    return index < 0 ? null : inventory.stockcount[index];
  };
  assert.equal(count(base, halberd), 0);
  assert.equal(count(after, halberd), 5);
  assert.equal(type.params.get(requiredId(types.ParamType, 'shop_title')), "Quatermaster's Stores");
});

console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} regicide-travel: ${passed} passed, ${failures.length} failed; ${builtTriggers.length} built, ${notBuiltTriggers.size} explicitly not built`);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
process.exit(0);
