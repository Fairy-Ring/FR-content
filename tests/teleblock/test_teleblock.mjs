#!/usr/bin/env node
/**
 * Tele Block compiled-content proof. Run from the sibling engine:
 *   node --import tsx ../content/tests/teleblock/test_teleblock.mjs
 * Loads the built pack and map; it does not start a server or use live accounts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
assert(fs.existsSync(path.join(pack, 'server/script.dat')), `compiled pack required at ${pack}`);
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);

const World = (await load('src/engine/World.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Loc = (await load('src/engine/entity/Loc.ts')).default;
const Provider = (await load('src/engine/script/ScriptProvider.ts')).default;
const Runner = (await load('src/engine/script/ScriptRunner.ts')).default;
const State = (await load('src/engine/script/ScriptState.ts')).default;
const Trigger = (await load('src/engine/script/ServerTriggerType.ts')).default;
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { CoordGrid } = await load('src/engine/CoordGrid.ts');
const { PlayerQueueType } = await load('src/engine/entity/PlayerQueueRequest.ts');
const OpHeld = (await load('src/network/game/client/model/OpHeld.ts')).default;
const OpHeldHandler = (await load('src/network/game/client/handler/OpHeldHandler.ts')).default;
const IfButton = (await load('src/network/game/client/model/IfButton.ts')).default;
const IfButtonHandler = (await load('src/network/game/client/handler/IfButtonHandler.ts')).default;
const OpLoc = (await load('src/network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await load('src/network/game/client/handler/OpLocHandler.ts')).default;

const types = {};
for (const name of [
  'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType',
  'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType',
  'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType', 'HuntType', 'IdkType',
]) {
  types[name] = (await load(`src/cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert.equal(Environment.NODE_PRODUCTION, false, 'use the non-production script error policy');
Environment.NODE_MEMBERS = true;
Environment.NODE_XPRATE = 1;
Environment.NODE_DEBUG_PROFILE = false;
assert(Provider.load(pack) > 0, 'load the compiled scripts');
World.gameMap.init();
World.currentTick = 1000;
World.vars = new Int32Array(types.VarSharedType.count);
World.varsString = new Array(types.VarSharedType.count).fill('');
World.processNpcEventQueue();

const id = (kind, name) => {
  const value = types[kind].getId(name);
  assert(value >= 0, `packed ${kind}:${name}`);
  return value;
};
const variable = (player, name, value) => {
  const varp = types.VarPlayerType.getId(name);
  if (varp >= 0) return value === undefined ? player.getVar(varp) : player.setVar(varp, value);
  const varbit = types.VarBitType.getId(name);
  assert(varbit >= 0, `packed VarPlayerType/VarBitType:${name}`);
  return value === undefined ? player.getVarBit(varbit) : player.setVarBit(varbit, value);
};
const spellTable = types.DbTableType.getByName('magic_spell_table');
assert(spellTable, 'magic_spell_table is packed');
const spellColumns = new Map(spellTable.columnNames.map((name, index) => [name, index]));
const row = name => {
  const result = types.DbRowType.getByName(name);
  assert(result, `packed DB row ${name}`);
  return result;
};
const values = (record, name) => {
  const index = spellColumns.get(name);
  assert.notEqual(index, undefined, `magic_spell_table column ${name}`);
  return record.getValue(index, 0);
};
const scalar = (record, name) => {
  const result = values(record, name);
  assert.equal(result.length, 1, `${record.debugname}.${name} has one value`);
  return result[0];
};
const teleblockRow = row('magic_spell_tele_block');
const spellComponent = id('Component', 'magic:com_531');
const spellTrigger = Provider.getByTrigger(Trigger.APPLAYERT, spellComponent, -1);
assert.equal(spellTrigger?.name, '[applayert,magic:com_531]', 'Tele Block uses its packed player-target component');
const npcTrigger = Provider.getByTrigger(Trigger.APNPCT, spellComponent, -1);
assert(npcTrigger, 'the packed NPC-target refusal is registered');
const teleblockQueueName = '[queue,teleblock_hit]';
const teleblockQueueScript = Provider.getByName(teleblockQueueName);
assert(teleblockQueueScript, 'the packed delayed hit handler exists');
const inv = id('InvType', 'inv');
const worn = id('InvType', 'worn');
const inventoryComponent = id('Component', 'inventory:inv');
const buttonHandler = new IfButtonHandler();
const heldHandler = new OpHeldHandler();
const locHandler = new OpLocHandler();
const teleblockVarpId = id('VarPlayerType', 'teleblock_until');
const teleblockVarpType = types.VarPlayerType.get(teleblockVarpId);
let serial = 0;

function sourceConstant(relative, name) {
  const source = fs.readFileSync(path.join(content, relative), 'utf8');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\^${escaped}\\s*=\\s*(-?\\d+)`, 'm'));
  assert(match, `source constant ${name} in ${relative}`);
  return Number(match[1]);
}
const dtComplete = sourceConstant('scripts/quests/quest_deserttreasure/configs/quest_deserttreasure.constant', 'dt_stage_complete');
const standardBook = sourceConstant('scripts/quests/quest_deserttreasure/configs/quest_deserttreasure.constant', 'dt_spellbook_standard');
const ancientBook = sourceConstant('scripts/quests/quest_deserttreasure/configs/quest_deserttreasure.constant', 'dt_spellbook_ancient');
const mep1Escorted = sourceConstant('scripts/quests/quest_mourning/configs/mep1.constant', 'mep1_escorted');

function runePairs(record) {
  const encoded = values(record, 'runesrequired');
  const result = [];
  for (let index = 0; index + 1 < encoded.length; index += 2) {
    if (encoded[index] === null || encoded[index] === undefined || encoded[index] < 0) continue;
    result.push([encoded[index], encoded[index + 1]]);
  }
  return result;
}
function addRunes(player, record, copies = 2) {
  for (const [object, count] of runePairs(record)) player.invAdd(inv, object, count * copies);
}
function itemCount(player, container, object) {
  let count = 0;
  const inventory = player.getInventory(container);
  for (let slot = 0; slot < inventory.capacity; slot++) {
    const item = player.invGetSlot(container, slot);
    if (item?.id === object) count += item.count;
  }
  return count;
}
function inventorySnapshot(player, container) {
  const inventory = player.getInventory(container);
  return Array.from({ length: inventory.capacity }, (_, slot) => {
    const item = player.invGetSlot(container, slot);
    return item ? [item.id, item.count] : null;
  });
}
function queueEntries(player, scriptName) {
  const found = [];
  for (const queue of [player.queue, player.weakQueue, player.engineQueue]) {
    for (const request of queue.all()) {
      if (request.script?.name === scriptName) found.push(request);
    }
  }
  return found;
}
function tile(player) {
  return [player.level, player.x, player.z];
}
function move(player, level, x, z) {
  player.level = level;
  player.x = player.originX = x;
  player.z = player.originZ = z;
}
function snapshot(player) {
  const vars = {};
  for (const name of [
    'action_delay', 'lastcombat', 'lastcombat_pvp', 'pk_skull', 'pk_prey1', 'pk_predator1', 'teleblock_until',
  ]) vars[name] = variable(player, name);
  return {
    inventory: inventorySnapshot(player, inv),
    worn: inventorySnapshot(player, worn),
    stats: Array.from(player.stats),
    levels: Array.from(player.levels),
    tile: tile(player),
    vars,
    pendingTeleblockHits: queueEntries(player, teleblockQueueName).length,
  };
}
function makePlayer(x = 3100, z = 3600) {
  const slot = ++serial;
  const player = new Player(`teleblock_${slot}`, BigInt(1000 + slot), BigInt(1000 + slot));
  Object.assign(player, {
    slot,
    pid: slot,
    uid: ((1000 + slot) << 11) | slot,
    level: 0,
    x,
    z,
    originX: x,
    originZ: z,
    isActive: true,
    lastMovement: -100,
  });
  player.baseLevels.fill(99);
  player.levels.fill(99);
  player.stats.fill(130344310);
  player.stats[PlayerStat.HITPOINTS] = 130344310;
  player.messages = [];
  player.packets = [];
  player.messageGame = player.wrappedMessageGame = text => player.messages.push(String(text));
  player.write = packet => player.packets.push(packet);
  World.players[slot] = player;
  World.playerLoop.add(player.hash64, player);
  player.moveSpeed = player.defaultMoveSpeed();
  player.getInventory(inv);
  player.getInventory(worn);
  variable(player, 'tutorial', 1000);
  variable(player, 'alternate_spells', standardBook);
  variable(player, 'action_delay', 0);
  variable(player, 'lastcombat', 0);
  variable(player, 'lastcombat_pvp', 0);
  variable(player, 'pk_skull', 0);
  variable(player, 'pk_prey1', 0);
  variable(player, 'pk_predator1', 0);
  variable(player, 'teleblock_until', 0);
  variable(player, 'prayer12', 0);
  variable(player, 'com_magicattack', 1000000);
  variable(player, 'com_magicdef', 1);
  return player;
}
function dispose(player) {
  player.clearInteraction();
  World.players[player.slot] = null;
  player.unlink();
  player.cleanup();
}
function pair(x = 3100, z = 3600, targetX = x + 1, targetZ = z) {
  const caster = makePlayer(x, z);
  const target = makePlayer(targetX, targetZ);
  return { caster, target };
}
function run(player, selector, target = null, args = []) {
  const script = typeof selector === 'string' ? Provider.getByName(selector) : selector;
  assert(script, `packed script ${selector}`);
  const state = Runner.init(script, player, target, args);
  const result = player.runScript(state, true, true);
  assert.equal(result, State.FINISHED, `${script.name}: ${player.messages.slice(-5).join(' | ')}`);
  assert.equal(state.execution, State.FINISHED, `${script.name} completed`);
  return state;
}
function begin(player, selector, target = null, args = []) {
  const script = typeof selector === 'string' ? Provider.getByName(selector) : selector;
  assert(script, `packed script ${selector}`);
  const state = Runner.init(script, player, target, args);
  player.runScript(state, true, true);
  return state;
}
function finish(player, state, option = 0) {
  for (let step = 0; state && state.execution !== State.FINISHED && step < 30; step++) {
    if (state.execution === State.PAUSEBUTTON) {
      const component = player.resumeButtons[option];
      assert.notEqual(component, undefined, `${state.script?.name}: offered choice ${option + 1}`);
      assert(buttonHandler.handle(new IfButton(component), player), 'real IfButtonHandler resumes the selected option');
    } else if (state.execution === State.SUSPENDED) {
      assert(player.delayed, `${state.script?.name}: suspended script has a native delay`);
      assert(player.delayedUntil > World.currentTick, `${state.script?.name}: delay is in the future`);
      World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
      player.delayed = false;
      player.executeScript(state, true, true);
    } else {
      assert.fail(`${state.script?.name}: unexpected execution state ${state.execution}`);
    }
  }
  assert(state, 'script state exists');
  assert.equal(state.execution, State.FINISHED, `${state.script?.name} finishes`);
}
function procInt(player, name, target = null, args = []) {
  const state = run(player, `[proc,${name}]`, target, args);
  assert.equal(state.isp, 1, `${name} returns one integer`);
  return state.intStack[0];
}
function deterministicRandom(valuesToReturn, callback) {
  const previous = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => valuesToReturn[draws++] ?? 0.5;
  try {
    const value = callback();
    return { value, draws };
  } finally {
    JavaRandom.nextDouble = previous;
  }
}
function castTeleblock(caster, target) {
  return run(caster, spellTrigger, target);
}
function addTeleblockRunes(player, copies = 2) {
  addRunes(player, teleblockRow, copies);
}
function snapshotPair(caster, target) {
  return { caster: snapshot(caster), target: snapshot(target) };
}
function assertPairUnchanged(before, caster, target, label) {
  assert.deepEqual(snapshotPair(caster, target), before, `${label}: no cast cost, skull, queue, or target effect`);
}
function tick(...players) {
  World.currentTick++;
  for (const player of players) player.processQueues();
}
function resolveTeleblockHit(caster, target, prayerAtImpact = false) {
  const queued = queueEntries(target, teleblockQueueName);
  assert.equal(queued.length, 1, 'one successful accuracy roll queues one native teleblock hit');
  const impact = World.currentTick + queued[0].delay + 1;
  assert.equal(procInt(target, 'teleblock_active'), 0, 'a queued projectile has not applied yet');
  while (World.currentTick < impact - 1) tick(caster, target);
  variable(target, 'prayer12', prayerAtImpact ? 1 : 0);
  tick(caster, target);
  assert.equal(World.currentTick, impact, 'hit resolves on the native queue boundary');
  return impact;
}
function blockedUntil(player) {
  const until = World.currentTick + 1000;
  variable(player, 'teleblock_until', until);
  return until;
}
function test(label, callback) {
  callback();
  console.log(`PASS Tele Block ${label}`);
}

function testDataAndVarp() {
  assert.equal(scalar(teleblockRow, 'spell'), 531, 'the row selects Tele Block 531');
  assert.equal(scalar(teleblockRow, 'spellcom'), spellComponent, 'the row names magic:com_531');
  assert.equal(scalar(teleblockRow, 'members'), 1);
  assert.equal(scalar(teleblockRow, 'levelrequired'), 85);
  assert.equal(scalar(teleblockRow, 'experience'), 800, 'spell XP is stored in tenths');
  assert.deepEqual(runePairs(teleblockRow), [
    [id('ObjType', 'lawrune'), 1],
    [id('ObjType', 'chaosrune'), 1],
    [id('ObjType', 'deathrune'), 1],
  ]);
  assert.equal(teleblockVarpType.scope, types.VarPlayerType.SCOPE_TEMP, 'the expiry is temporary player state');
  assert.equal(teleblockVarpType.transmit, false, 'the expiry is not transmitted to the client');
}

function testHitsAndExpiry() {
  for (const scenario of [
    { name: 'unprotected impact', prayerAtCast: true, prayerAtImpact: false, duration: 500 },
    { name: 'Protect Magic at impact', prayerAtCast: false, prayerAtImpact: true, duration: 250 },
  ]) {
    const { caster, target } = pair();
    try {
      variable(target, 'prayer12', scenario.prayerAtCast ? 1 : 0);
      addTeleblockRunes(caster, 2);
      const beforeStats = Array.from(caster.stats);
      const targetStats = Array.from(target.stats);
      const targetHp = target.levels[PlayerStat.HITPOINTS];
      const runesBefore = runePairs(teleblockRow).map(([object]) => itemCount(caster, inv, object));
      const skullBefore = variable(caster, 'pk_skull');
      deterministicRandom([0.999999, 0], () => castTeleblock(caster, target));

      const expectedStats = [...beforeStats];
      expectedStats[PlayerStat.MAGIC] += 800;
      assert.deepEqual(Array.from(caster.stats), expectedStats, 'a non-damaging cast awards exactly the row XP and no combat XP');
      assert.deepEqual(Array.from(target.stats), targetStats, 'the target gains no combat XP');
      assert.equal(target.levels[PlayerStat.HITPOINTS], targetHp, 'Tele Block cannot damage HP');
      for (const [index, [object, count]] of runePairs(teleblockRow).entries()) {
        assert.equal(itemCount(caster, inv, object), runesBefore[index] - count, 'a successful cast spends one of each rune');
      }
      assert(variable(caster, 'pk_skull') > skullBefore, 'the accepted Wilderness cast applies the ordinary skull timer');
      assert.equal(variable(target, 'pk_predator1'), caster.uid, 'the target records the caster as predator');
      assert.equal(variable(target, 'teleblock_until'), 0, 'the expiry is not written at cast time');
      assert.equal(queueEntries(target, teleblockQueueName).length, 1, 'a hit queues one delayed target-owned effect');

      const impact = resolveTeleblockHit(caster, target, scenario.prayerAtImpact);
      const expiry = variable(target, 'teleblock_until');
      assert.equal(expiry, impact + scenario.duration, `${scenario.name} duration begins on impact`);
      assert.equal(procInt(target, 'teleblock_active'), 1, 'the applied timer is active');
      assert.equal(target.levels[PlayerStat.HITPOINTS], targetHp, 'the delayed hit still deals no damage');
      assert.deepEqual(Array.from(target.stats), targetStats, 'the delayed hit grants no combat XP');
      assert.deepEqual(Array.from(caster.stats), expectedStats, 'the delayed hit adds no combat XP');

      World.currentTick = expiry - 1;
      assert.equal(procInt(target, 'teleblock_active'), 1, 'the effect remains active one tick before expiry');
      assert.equal(procInt(target, 'teleblock_check'), 0, 'the teleport gate rejects an active effect');
      assert(target.messages.length > 0, 'an active teleport refusal is presented');
      World.currentTick = expiry;
      assert.equal(procInt(target, 'teleblock_active'), 0, 'the effect expires at its timestamp');
      assert.equal(procInt(target, 'teleblock_check'), 1, 'the teleport gate admits the exact expiry boundary');
    } finally {
      dispose(caster);
      dispose(target);
    }
  }
}

function testSplashAndRecastBoundary() {
  {
    const { caster, target } = pair();
    try {
      variable(caster, 'com_magicattack', 1);
      variable(target, 'com_magicdef', 100000000);
      addTeleblockRunes(caster, 2);
      const beforeStats = Array.from(caster.stats);
      const targetStats = Array.from(target.stats);
      const targetHp = target.levels[PlayerStat.HITPOINTS];
      const runeCounts = runePairs(teleblockRow).map(([object]) => itemCount(caster, inv, object));
      deterministicRandom([0, 0.999999], () => castTeleblock(caster, target));
      const expectedStats = [...beforeStats];
      expectedStats[PlayerStat.MAGIC] += 800;
      assert.deepEqual(Array.from(caster.stats), expectedStats, 'a splash still pays and awards only cast XP');
      assert.deepEqual(Array.from(target.stats), targetStats);
      assert.equal(target.levels[PlayerStat.HITPOINTS], targetHp);
      for (const [index, [object, count]] of runePairs(teleblockRow).entries()) {
        assert.equal(itemCount(caster, inv, object), runeCounts[index] - count);
      }
      assert(variable(caster, 'pk_skull') > World.currentTick, 'a splashed but accepted cast still enters PvP aggression');
      assert.equal(variable(target, 'pk_predator1'), caster.uid);
      assert.equal(variable(target, 'teleblock_until'), 0, 'a splash never writes the target timer');
      assert.equal(queueEntries(target, teleblockQueueName).length, 0, 'a splash queues no delayed effect');
    } finally {
      dispose(caster);
      dispose(target);
    }
  }

  {
    const { caster, target } = pair();
    try {
      addTeleblockRunes(caster, 4);
      deterministicRandom([0.999999, 0], () => castTeleblock(caster, target));
      const impact = resolveTeleblockHit(caster, target, false);
      const expiry = variable(target, 'teleblock_until');
      assert.equal(expiry, impact + 500);
      World.currentTick = expiry + 99;
      assert.equal(procInt(target, 'teleblock_active'), 0, 'the effect itself has expired');
      const before = snapshotPair(caster, target);
      const denied = deterministicRandom([0.999999, 0], () => castTeleblock(caster, target));
      assert.equal(denied.draws, 0, 'the +99 recast guard exits before accuracy');
      assertPairUnchanged(before, caster, target, 'recast at expiry + 99');

      World.currentTick = expiry + 100;
      const runeCounts = runePairs(teleblockRow).map(([object]) => itemCount(caster, inv, object));
      const statsBefore = Array.from(caster.stats);
      deterministicRandom([0.999999, 0], () => castTeleblock(caster, target));
      const expectedStats = [...statsBefore];
      expectedStats[PlayerStat.MAGIC] += 800;
      assert.deepEqual(Array.from(caster.stats), expectedStats, 'recast at +100 is admitted and charged');
      for (const [index, [object, count]] of runePairs(teleblockRow).entries()) {
        assert.equal(itemCount(caster, inv, object), runeCounts[index] - count);
      }
      assert.equal(variable(target, 'teleblock_until'), expiry, 'the new block is still delayed until projectile impact');
      assert.equal(queueEntries(target, teleblockQueueName).length, 1, 'the +100 recast queues a new hit');
      resolveTeleblockHit(caster, target, false);
      assert.equal(variable(target, 'teleblock_until'), World.currentTick + 500, 'the admitted recast applies on its own impact');
    } finally {
      dispose(caster);
      dispose(target);
    }
  }
}

function rejectedCast(label, { x = 3100, z = 3600, targetX = x + 1, targetZ = z, runes = true, setup = null, members = true } = {}) {
  const { caster, target } = pair(x, z, targetX, targetZ);
  const oldMembers = Environment.NODE_MEMBERS;
  try {
    if (runes) addTeleblockRunes(caster, 2);
    if (setup) setup(caster, target);
    Environment.NODE_MEMBERS = members;
    const before = snapshotPair(caster, target);
    deterministicRandom([0.999999, 0], () => castTeleblock(caster, target));
    assertPairUnchanged(before, caster, target, label);
  } finally {
    Environment.NODE_MEMBERS = oldMembers;
    dispose(caster);
    dispose(target);
  }
}

function testEligibilityAndNpcRefusal() {
  rejectedCast('safe-side Wilderness boundary', { z: 3519, targetZ: 3519 });
  rejectedCast('target outside the Wilderness', { z: 3520, targetZ: 3519 });
  rejectedCast('level-range refusal', {
    setup: (_caster, target) => {
      target.baseLevels.fill(1);
      target.levels.fill(1);
    },
  });
  rejectedCast('single-combat opponent already fighting someone else', {
    setup: (_caster, target) => {
      variable(target, 'lastcombat', World.currentTick);
      variable(target, 'pk_predator1', 999999);
    },
  });
  rejectedCast('below level 85', {
    setup: caster => {
      caster.baseLevels[PlayerStat.MAGIC] = 84;
      caster.levels[PlayerStat.MAGIC] = 84;
    },
  });
  rejectedCast('missing runes', { runes: false });
  rejectedCast('non-member world', { members: false });
  rejectedCast('Ancient spellbook', {
    setup: caster => variable(caster, 'alternate_spells', ancientBook),
  });

  for (const scenario of [
    { name: 'Castle Wars', x: 2400, z: 3100, setup: (caster, target) => {
      variable(caster, 'castlewars_team', 0);
      variable(target, 'castlewars_team', 1);
    } },
    { name: 'Duel Arena', x: 3340, z: 3250, setup: (caster, target) => {
      variable(caster, 'duel2accept', target.uid);
      variable(target, 'duel2accept', caster.uid);
      variable(caster, 'duelstatus', 6);
      variable(target, 'duelstatus', 6);
      variable(caster, 'dueloptions', 0);
    } },
  ]) {
    const { caster, target } = pair(scenario.x, scenario.z);
    try {
      addTeleblockRunes(caster, 2);
      scenario.setup(caster, target);
      assert.equal(procInt(caster, 'pvp_is_attackable_opt', target), 1,
        `${scenario.name} fixture is admitted by the generic PvP spell pipeline`);
      const before = snapshotPair(caster, target);
      deterministicRandom([0.999999, 0], () => castTeleblock(caster, target));
      assertPairUnchanged(before, caster, target, `${scenario.name} is not a Tele Block area`);
    } finally {
      dispose(caster);
      dispose(target);
    }
  }

  const player = makePlayer();
  try {
    addTeleblockRunes(player, 2);
    const before = snapshot(player);
    run(player, npcTrigger);
    assert.deepEqual(snapshot(player), before, 'the real APNPCT entry stops without runes, XP, skull or target state');
  } finally {
    dispose(player);
  }
}

function runBlockedTeleport(player, scriptName, spellRowName, book, requireDesertTreasure = false) {
  variable(player, 'alternate_spells', book);
  if (requireDesertTreasure) variable(player, 'deserttreasure', dtComplete);
  addRunes(player, row(spellRowName), 2);
  const until = blockedUntil(player);
  const before = snapshot(player);
  run(player, scriptName);
  assert.deepEqual(snapshot(player), before, `${scriptName}: active Tele Block preserves runes, XP and position`);
  assert.equal(variable(player, 'teleblock_until'), until);
}

function nativeHeld(player, itemName, optionName) {
  const item = types.ObjType.getByName(itemName);
  assert(item, `packed ObjType:${itemName}`);
  const option = item.iop.findIndex(value => value?.toLowerCase() === optionName.toLowerCase()) + 1;
  assert(option > 0, `${itemName} has ${optionName}`);
  const trigger = Provider.getByTrigger(Trigger.OPHELD1 + option - 1, item.id, item.category);
  assert(trigger, `packed OPHELD${option} trigger for ${itemName}`);
  const slot = Array.from({ length: player.getInventory(inv).capacity }, (_, index) => index)
    .find(index => player.invGetSlot(inv, index)?.id === item.id);
  assert.notEqual(slot, undefined, `${itemName} is in the listened inventory`);
  player.invListenOnCom(inv, inventoryComponent, player.uid);
  player.tabs[3] = types.Component.get(inventoryComponent).rootLayer;
  let dispatched = null;
  let dispatchedScript = null;
  const execute = player.executeScript;
  player.executeScript = function (state, ...args) {
    if (!dispatched) {
      dispatched = state;
      dispatchedScript = state.script;
    }
    return execute.call(this, state, ...args);
  };
  try {
    assert(heldHandler.handle(new OpHeld(option, item.id, slot, inventoryComponent), player),
      `${itemName} reaches the real OpHeldHandler`);
  } finally {
    player.executeScript = execute;
  }
  assert.equal(dispatchedScript, trigger, `${itemName} resolves its compiled held-item trigger`);
  return dispatched;
}

function testTeleportConsumers() {
  for (const [script, spellRowName, book, ancient] of [
    ['[if_button,magic:varrock_teleport]', 'magic_spell_teleport_varrock', standardBook, false],
    ['[if_button,inter_267:com_179]', 'magic_spell_teleport_paddewwa', ancientBook, true],
  ]) {
    const player = makePlayer(3200, 3200);
    try {
      runBlockedTeleport(player, script, spellRowName, book, ancient);
    } finally {
      dispose(player);
    }
  }

  for (const [itemName, option] of [
    ['ectophial', 'empty'],
    ['mourning_teleport_crystal_4', 'activate'],
    ['amulet_of_glory_4', 'rub'],
    ['ring_of_dueling_8', 'rub'],
    ['necklace_of_minigames_8', 'rub'],
  ]) {
    const player = makePlayer(3200, 3200);
    try {
      if (itemName === 'mourning_teleport_crystal_4') variable(player, 'mourning_quest', mep1Escorted);
      const item = types.ObjType.getByName(itemName);
      assert(item, `packed ObjType:${itemName}`);
      player.invAdd(inv, item.id, 1);
      const until = blockedUntil(player);
      const before = snapshot(player);
      const state = nativeHeld(player, itemName, option);
      finish(player, state, 0);
      assert.deepEqual(snapshot(player), before, `${itemName}: active Tele Block preserves the item and blocks travel`);
      assert.equal(variable(player, 'teleblock_until'), until);
    } finally {
      dispose(player);
    }
  }

  {
    const player = makePlayer(3200, 3200);
    try {
      const ring = types.ObjType.getByName('ring_of_life');
      assert(ring, 'packed ring_of_life');
      player.invSet(worn, ring.id, 1, ring.wearpos);
      player.levels[PlayerStat.HITPOINTS] = 5;
      const until = blockedUntil(player);
      const before = snapshot(player);
      run(player, '[proc,ring_of_life_check]');
      assert.deepEqual(snapshot(player), before, 'Ring of Life pre-teleport checks preserve the worn ring and position');
      assert.equal(variable(player, 'teleblock_until'), until);
    } finally {
      dispose(player);
    }
  }
}

function operateLoc(player, name) {
  const type = types.LocType.getByName(name);
  assert(type, `packed LocType:${name}`);
  assert(type.op?.[0] && type.op[0] !== 'hidden', `${name} has its native first option`);
  const loc = new Loc(player.level, player.x + 1, player.z, type.width, type.length,
    EntityLifeCycle.DESPAWN, type.id, type.shapes?.[0] ?? 10, 0);
  World.addLoc(loc, -1);
  try {
    assert(locHandler.handle(new OpLoc(1, loc.x, loc.z, loc.type), player), `${name} is accepted by OpLocHandler`);
    const script = player.getOpTrigger();
    assert.equal(script?.name, `[oploc1,${name}]`, `${name} resolves through the real OPLOC1 trigger`);
    const state = begin(player, script, loc);
    finish(player, state, 0);
  } finally {
    World.removeLoc(loc, 0);
  }
}

function testLeverAndObeliskConsumers() {
  for (const name of [
    'wildinlever', 'wildoutlever',
    'magearena_lever_to_cellar', 'magearena_lever_from_cellar',
    'dragonkinginlever', 'dragonkingoutlever',
  ]) {
    const player = makePlayer(3200, 3200);
    try {
      const until = blockedUntil(player);
      const before = tile(player);
      operateLoc(player, name);
      assert.deepEqual(tile(player), before, `${name}: active Tele Block prevents the lever departure`);
      assert.equal(variable(player, 'teleblock_until'), until);
    } finally {
      dispose(player);
    }
  }

  for (const name of ['magearena_lever_in', 'magearena_lever_out']) {
    const player = makePlayer(3200, 3200);
    try {
      const until = blockedUntil(player);
      const before = tile(player);
      operateLoc(player, name);
      assert.notDeepEqual(tile(player), before, `${name}: inner Mage Arena lever retains its unblocked behavior`);
      assert.equal(variable(player, 'teleblock_until'), until, `${name} does not clear the independent target timer`);
      assert.equal(procInt(player, 'teleblock_active'), 1);
    } finally {
      dispose(player);
    }
  }

  const blocked = makePlayer(3100, 3600);
  const free = makePlayer(3102, 3600);
  try {
    const until = blockedUntil(blocked);
    const destination = CoordGrid.packCoord(0, 3200, 3200);
    const beforeBlocked = tile(blocked);
    const beforeFree = tile(free);
    const queueScript = Provider.getByName('[queue,wilderness_obelisk_teleport_after_timer]');
    assert(queueScript, 'the obelisk departure queue is packed');
    blocked.enqueueScript(queueScript, PlayerQueueType.NORMAL, 0, [destination]);
    free.enqueueScript(queueScript, PlayerQueueType.NORMAL, 0, [destination]);
    tick(blocked, free);
    assert.deepEqual(tile(blocked), beforeBlocked, 'the blocked target exits its own obelisk queue without moving');
    assert.equal(variable(blocked, 'teleblock_until'), until);
    assert(free.activeScript, 'the unblocked target runs its own queued departure');
    finish(free, free.activeScript, 0);
    assert.deepEqual(tile(free), [0, 3200, 3200], 'the independently admitted target reaches the queued destination');
  } finally {
    dispose(blocked);
    dispose(free);
  }
}

function launchHit(caster, target) {
  addTeleblockRunes(caster, 4);
  deterministicRandom([0.999999, 0], () => castTeleblock(caster, target));
}
function targetClearCase(kind, resolveFirst) {
  const { caster, target } = pair();
  try {
    launchHit(caster, target);
    if (resolveFirst) {
      resolveTeleblockHit(caster, target, false);
      assert(variable(target, 'teleblock_until') > World.currentTick, `${kind} fixture has an active target timer`);
    } else {
      assert.equal(queueEntries(target, teleblockQueueName).length, 1, `${kind} fixture has a pending projectile`);
    }
    if (kind === 'death') {
      target.levels[PlayerStat.HITPOINTS] = 0;
      run(target, '[proc,player_die]');
      target.processQueues();
    } else {
      run(target, '[logout,_]');
    }
    assert.equal(variable(target, 'teleblock_until'), 0, `${kind} clears target-owned Tele Block state`);
    assert.equal(queueEntries(target, teleblockQueueName).length, 0, `${kind} clears pending Tele Block hits`);
    assert.equal(procInt(target, 'teleblock_active'), 0);
  } finally {
    dispose(caster);
    dispose(target);
  }
}

function testOwnershipAndClear() {
  {
    const { caster, target } = pair();
    try {
      launchHit(caster, target);
      resolveTeleblockHit(caster, target, false);
      const expiry = variable(target, 'teleblock_until');
      move(caster, 0, 3200, 3200);
      run(caster, '[logout,_]');
      assert.equal(variable(target, 'teleblock_until'), expiry, 'caster logout does not clear the victim timer');
      assert.equal(procInt(target, 'teleblock_active'), 1);
      move(target, 0, 3200, 3200);
      assert.equal(variable(target, 'teleblock_until'), expiry, 'walking out of the Wilderness does not clear the victim timer');
      assert.equal(procInt(target, 'teleblock_active'), 1);
    } finally {
      dispose(caster);
      dispose(target);
    }
  }

  for (const kind of ['death', 'logout']) {
    targetClearCase(kind, true);
    targetClearCase(kind, false);
  }
}

test('DB row and temporary, non-transmitted expiry varp', testDataAndVarp);
test('successful hit, impact-time prayer, no damage/XP, and expiry boundary', testHitsAndExpiry);
test('splash and +99/+100 recast immunity boundary', testSplashAndRecastBoundary);
test('Wilderness, levels, single-combat, spell requirements, Castle Wars, Duel Arena and NPC refusals', testEligibilityAndNpcRefusal);
test('standard/Ancient spells, Ectophial, crystal, charged jewelry and Ring of Life consumers', testTeleportConsumers);
test('Wilderness levers, Mage Arena carveout, KBD levers and per-target obelisk queues', testLeverAndObeliskConsumers);
test('target-owned persistence and death/logout clearing', testOwnershipAndClear);

console.log('RESULT PASS teleblock 7 compiled groups');
process.exit(0);
