#!/usr/bin/env node
/** Compiled Mogre summon, Slayer admission, poison immunity, death and drops. No server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.resolve(here, '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engine, relative)).href);

const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const Loc = (await load('src/engine/entity/Loc.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const { NpcMode } = await load('src/engine/entity/NpcMode.ts');
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const map = await load('src/engine/GameMap.ts');
const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');
const OpLoc = (await load('src/network/game/client/model/OpLoc.ts')).default;
const OpLocU = (await load('src/network/game/client/model/OpLocU.ts')).default;
const locHandler = new ((await load('src/network/game/client/handler/OpLocHandler.ts')).default)();
const locUseHandler = new ((await load('src/network/game/client/handler/OpLocUHandler.ts')).default)();

const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType',
  'IdkType', 'Component', 'FontType']) {
  types[name] = (await load(`src/cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert.equal(Environment.NODE_PRODUCTION, false, 'run under the non-production script error policy');
assert.equal(Environment.NODE_XPRATE, 1, 'Slayer XP is checked in unmultiplied tenths');
Environment.NODE_MEMBERS = true;
assert(ScriptProvider.load(pack) > 0, 'load real compiled scripts');
World.gameMap.init();
assert(World.gameMap.getTotalLocs() > 0, 'load the packed world map');
World.npcs.reset();
for (const request of World.npcEventQueue.all()) request.unlink();
World.currentTick = 100;

const { VarPlayerType, VarBitType, VarNpcType, ParamType, ObjType, LocType, NpcType,
  InvType, DbTableType, DbRowType } = types;
const id = (kind, name) => {
  const value = types[kind].getId(name);
  assert(value >= 0, `missing packed ${kind}:${name}`);
  return value;
};
const inv = id('InvType', 'inv');
const invComponent = id('Component', 'inventory:inv');
const mogreNpcType = NpcType.getByName('mudskipper_ogre');
assert(mogreNpcType, 'packed mudskipper_ogre NPC type');
const mogreNpcId = id('NpcType', 'mudskipper_ogre');
const invType = InvType.get(inv);
const skippyBit = id('VarBitType', 'skippy_state');
const ids = {
  slayerTarget: id('VarPlayerType', 'slayer_target'),
  slayerCount: id('VarPlayerType', 'slayer_count'),
  aggressivePlayer: id('VarNpcType', 'npc_aggressive_player'),
  attackingUid: id('VarNpcType', 'npc_attacking_uid'),
  poison: id('VarNpcType', 'npc_poison'),
  fishingExplosive: id('ObjType', 'fishing_explosive'),
  hammer: id('ObjType', 'hammer'),
  bigBones: id('ObjType', 'big_bones')
};
const playerStatsForCombat = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE,
  PlayerStat.HITPOINTS, PlayerStat.PRAYER, PlayerStat.RANGED, PlayerStat.MAGIC];
const taskConstants = readConstants(path.join(content, 'scripts/skill_slayer/configs/slayer.constant'));
const skippyConstants = readConstants(path.join(content, 'scripts/areas/area_rimmington/configs/skippy.constant'));
const mogreConstants = readConstants(path.join(content, 'scripts/skill_slayer/configs/mogre.constant'));
const mogreTaskValue = numericConstant(taskConstants, 'slayer_mogre');
const ogreTaskValue = numericConstant(taskConstants, 'slayer_ogre');
const skippyComplete = numericConstant(skippyConstants, 'skippy_complete');
const throwRange = numericConstant(mogreConstants, 'mogre_throw_range');
const unsafeRange = numericConstant(mogreConstants, 'mogre_unsafe_range');
const lifetime = numericConstant(mogreConstants, 'mogre_lifetime');
assert.notEqual(mogreTaskValue, ogreTaskValue, 'Mogre is not the old Ogre task category');
assert.equal(throwRange, 6, 'checked UNKNOWN approach range is six tiles');
assert.equal(unsafeRange, 2, 'checked CANDIDATE unsafe radius is two tiles');
assert(lifetime > 0, 'checked UNKNOWN summon lifetime is finite');

let assertions = 0;
function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}
function readConstants(file) {
  const values = new Map();
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const separator = line.indexOf('=');
    assert(separator > 0, `${file}: malformed constant ${rawLine}`);
    const name = line.slice(0, separator).trim().replace(/^\^/, '');
    const value = line.slice(separator + 1).trim();
    assert(!values.has(name), `${file}: duplicate constant ${name}`);
    values.set(name, value);
  }
  return values;
}
function constant(values, name) {
  const raw = values.get(name);
  assert.notEqual(raw, undefined, `checked source constant ^${name}`);
  return raw;
}
function numericConstant(values, name) {
  const raw = constant(values, name);
  assert.match(raw, /^-?\d+$/, `^${name} is an integer`);
  return Number(raw);
}
function parseDbRows(file) {
  const rows = new Map();
  let current = null;
  for (const [index, rawLine] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1);
      assert(name && !rows.has(name), `${file}:${index + 1}: duplicate/empty row ${name}`);
      current = { name, table: null, data: new Map() };
      rows.set(name, current);
      continue;
    }
    assert(current, `${file}:${index + 1}: DBRow property outside a row`);
    const separator = line.indexOf('=');
    assert(separator > 0, `${file}:${index + 1}: malformed DBRow property`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === 'table') {
      assert.equal(current.table, null, `${file}:${index + 1}: repeated table property`);
      current.table = value;
    } else if (key === 'data') {
      const comma = value.indexOf(',');
      assert(comma > 0, `${file}:${index + 1}: malformed data property`);
      const column = value.slice(0, comma).trim();
      const values = current.data.get(column) ?? [];
      values.push(value.slice(comma + 1).trim());
      current.data.set(column, values);
    } else {
      assert.fail(`${file}:${index + 1}: unexpected DBRow property ${key}`);
    }
  }
  return rows;
}
function sourceInteger(raw, context) {
  if (raw.startsWith('^')) return numericConstant(taskConstants, raw.slice(1));
  assert.match(raw, /^-?\d+$/, `${context} is an integer`);
  return Number(raw);
}
function packedRow(name) {
  const rowId = DbRowType.getId(name);
  assert(rowId >= 0, `packed DBRow ${name}`);
  const row = DbRowType.get(rowId);
  assert(row, `packed DBRow id for ${name}`);
  return { id: rowId, row };
}
function packedValues(row, name) {
  const table = DbTableType.get(row.tableId);
  assert(table, `packed DbTableType ${row.tableId}`);
  const column = table.columnNames.indexOf(name);
  assert(column >= 0, `packed DBTable column ${name}`);
  const encoded = row.columnValues[column] ?? [];
  const arity = row.types[column]?.length ?? 1;
  assert.equal(encoded.length % arity, 0, `packed ${name} values form complete tuples`);
  return Array.from({ length: encoded.length / arity }, (_, index) => {
    const value = row.getValue(column, index);
    return Array.isArray(value) ? value[0] : value;
  });
}
function sourceValues(row, name) {
  const values = row.data.get(name) ?? [];
  assert(values.length, `${row.name} source column ${name}`);
  return values;
}
function sourceIntegerColumn(row, name) {
  const values = sourceValues(row, name);
  assert.equal(values.length, 1, `${row.name}.${name} has one source value`);
  return sourceInteger(values[0], `${row.name}.${name}`);
}

// Compare all checked-source membership for the four real Mogre-bearing masters
// with their actual packed parent and child rows, not generated row ids.
const masterSources = parseDbRows(path.join(content, 'scripts/skill_slayer/configs/slayer_master_tasks.dbrow'));
const taskSources = parseDbRows(path.join(content, 'scripts/skill_slayer/configs/slayer_tasks.dbrow'));
const masterSnapshot = JSON.parse(fs.readFileSync(path.join(here, '../slayer-selector/master_tables.json'), 'utf8'));
const snapshotOwners = Object.entries(masterSnapshot).flatMap(([master, rows]) =>
  rows.filter(([, category]) => category === 'mogre').map(([suffix, , weight, min, max]) => ({
    master, child: `${master}_${suffix}`, weight, min, max
  })));
check('fixed Slayer source names exactly four Mogre-bearing masters', snapshotOwners.map(row => row.master),
  ['mazchna', 'vannaka', 'chaeldar', 'duradel']);
const sourceMogreRows = [...taskSources.values()].filter(row => sourceIntegerColumn(row, 'task') === mogreTaskValue)
  .map(row => row.name).sort();
check('checked task source has the four Mogre assignment rows', sourceMogreRows,
  snapshotOwners.map(row => row.child).sort());
for (const expected of snapshotOwners) {
  const masterName = `${expected.master}_task_table`;
  const parentSource = masterSources.get(masterName);
  assert(parentSource, `checked master source ${masterName}`);
  const childNames = sourceValues(parentSource, 'task');
  check(`${masterName} checked-source membership contains ${expected.child} once`,
    childNames.filter(name => name === expected.child).length, 1);
  const { id: parentId, row: packedParent } = packedRow(masterName);
  assert.equal(packedParent.tableId, DbTableType.getId('slayer_task_table'), `${masterName} packed task table`);
  const childRefs = packedValues(packedParent, 'task');
  check(`${masterName} packed membership matches checked source order`, childRefs,
    childNames.map(name => packedRow(name).id));
  check(`${masterName} source-backed row resolves to packed child`, childRefs.includes(packedRow(expected.child).id), true);
  check(`${masterName} packed parent identity is content-local`, Number.isInteger(parentId), true);

  const taskSource = taskSources.get(expected.child);
  assert(taskSource, `checked task source ${expected.child}`);
  const sourceTuple = [sourceIntegerColumn(taskSource, 'task'), sourceIntegerColumn(taskSource, 'weight'),
    sourceIntegerColumn(taskSource, 'min_amount'), sourceIntegerColumn(taskSource, 'max_amount')];
  check(`${expected.child} checked-source task, weight and range`, sourceTuple,
    [mogreTaskValue, expected.weight, expected.min, expected.max]);
  const packedChild = packedRow(expected.child).row;
  check(`${expected.child} packed task, weight and range match checked source`,
    ['task', 'weight', 'min_amount', 'max_amount'].map(name => Number(packedValues(packedChild, name)[0])), sourceTuple);
}

const slayerParam = ParamType.getByName('slayer_category');
assert(slayerParam, 'packed Slayer category parameter');
check('packed Mogre uses the Mogre task category, not Ogre',
  ParamHelper.getIntParam(slayerParam.id, mogreNpcType, slayerParam.defaultInt), mogreTaskValue);
check('packed Mogre task category differs from the Ogre task',
  ParamHelper.getIntParam(slayerParam.id, mogreNpcType, slayerParam.defaultInt) === ogreTaskValue, false);
check('Mogre packed hitpoints', mogreNpcType.stats[NpcStat.HITPOINTS], 48);
check('Mogre packed Attack', mogreNpcType.stats[NpcStat.ATTACK], 58);
check('Mogre packed Strength', mogreNpcType.stats[NpcStat.STRENGTH], 55);
check('Mogre packed Defence', mogreNpcType.stats[NpcStat.DEFENCE], 48);
check('Mogre packed Magic', mogreNpcType.stats[NpcStat.MAGIC], 1);
check('Mogre packed Ranged', mogreNpcType.stats[NpcStat.RANGED], 1);
check('Mogre is the packed 2x2 target', mogreNpcType.size, 2);

function decodeCoord(raw, label) {
  const match = /^(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$/.exec(raw);
  assert(match, `${label} is a packed level_regionX_regionZ_localX_localZ coordinate`);
  const [level, regionX, regionZ, localX, localZ] = match.slice(1).map(Number);
  return { level, x: regionX * 64 + localX, z: regionZ * 64 + localZ };
}
const locations = [
  { name: 'ominous_fishing_spot_a', level: 0, x: 2982, z: 3113, landing: 'mogre_west_landing' },
  { name: 'ominous_fishing_spot_b', level: 0, x: 2996, z: 3106, landing: 'mogre_south_landing' },
  { name: 'ominous_fishing_spot_c', level: 0, x: 3005, z: 3117, landing: 'mogre_east_landing' }
].map(entry => {
  const type = LocType.getByName(entry.name);
  assert(type, `packed ${entry.name} LocType`);
  const loc = World.getLoc(entry.x, entry.z, entry.level, type.id);
  assert(loc, `real packed world placement ${entry.name}`);
  check(`${entry.name} real packed map coordinate`, [loc.level, loc.x, loc.z], [entry.level, entry.x, entry.z]);
  check(`${entry.name} visible Lure option`, type.op?.[0], 'Lure');
  check(`${entry.name} visible Bait option`, type.op?.[1], 'Bait');
  const landing = decodeCoord(constant(mogreConstants, entry.landing), entry.landing);
  for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
    const x = landing.x + dx, z = landing.z + dz;
    check(`${entry.landing} packed zone allocated at ${x},${z}`,
      map.isZoneAllocated(landing.level, x, z), true);
    check(`${entry.landing} packed 2x2 tile walkable at ${x},${z}`,
      map.isMapBlocked(x, z, landing.level), false);
  }
  return { ...entry, type, loc, landing };
});

const fishingEmptyText = 'Something seems to have scared all the fishes away...';
const incompleteText = 'Sinister as that fishing spot is, why would I want to explode it?';
const tooCloseText = 'If this thing explodes, I think I should stand a liiiiittle further away...';
const mogreSayings = [
  'Human scare all da fishies!', 'I smack you good!', 'Da boom-boom kill all da fishies!',
  'Tasty human!', 'Smash stupid human!', 'I get you!', 'Human hit me on the head!'
];

let playerSerial = 0;
function setCombatLevels(player, level) {
  for (const stat of playerStatsForCombat) {
    player.baseLevels[stat] = level;
    player.levels[stat] = level;
  }
}
function makePlayer({ slayer = 32, combat = 24, skippy = skippyComplete, taskTarget = 0,
  taskCount = 0, position = null } = {}) {
  const serial = ++playerSerial;
  const hash = BigInt(9000 + serial);
  const player = new Player(`mogretest${serial}`, hash, hash);
  player.slot = serial;
  player.pid = serial;
  player.uid = ((Number(hash & 0x1fffffn) << 11) | serial) >>> 0;
  player.level = position?.level ?? 0;
  player.x = position?.x ?? 2960 + (serial % 12) * 8;
  player.z = position?.z ?? 3100 + Math.floor(serial / 12) * 8;
  player.isActive = true;
  player.vars.fill(0);
  player.baseLevels.fill(1);
  player.levels.fill(1);
  player.stats.fill(130344310);
  setCombatLevels(player, combat);
  player.baseLevels[PlayerStat.SLAYER] = slayer;
  player.levels[PlayerStat.SLAYER] = slayer;
  player.messages = [];
  player.packets = [];
  player.write = packet => player.packets.push(packet);
  player.messageGame = text => player.messages.push(String(text));
  player.wrappedMessageGame = player.messageGame;
  player.getInventory(inv);
  player.getInventory(id('InvType', 'worn'));
  const inventoryComponent = types.Component.get(invComponent);
  player.tabs[3] = inventoryComponent.rootLayer;
  player.invListenOnCom(inv, invComponent, player.uid);
  player.setVarBit(skippyBit, skippy);
  player.setVar(ids.slayerTarget, taskTarget);
  player.setVar(ids.slayerCount, taskCount);
  World.players[player.slot] = player;
  World.playerLoop.add(player.hash64, player);
  return player;
}
function give(player, itemId, count = 1) {
  player.invAdd(inv, itemId, count);
}
function count(player, itemId) {
  return player.invTotal(inv, itemId);
}
function allText(player) {
  return [...player.messages, ...player.packets.map(packet => packet.text ?? packet.msg ?? '')]
    .join(' ').replaceAll('|', ' ').replace(/\s+/g, ' ').trim();
}
function runPlayerScript(player, scriptOrName, target = null, args = []) {
  const script = typeof scriptOrName === 'string' ? ScriptProvider.getByName(scriptOrName) : scriptOrName;
  assert(script, `packed player script ${scriptOrName}`);
  const state = ScriptRunner.init(script, player, target, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  player.executeScript(state, true, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} did not abort`);
  assert.equal(state.execution, ScriptState.FINISHED, `${script.name} finishes`);
  return state;
}
function runNpcScript(npc, scriptOrName, target = null, args = []) {
  const script = typeof scriptOrName === 'string' ? ScriptProvider.getByName(scriptOrName) : scriptOrName;
  assert(script, `packed NPC script ${scriptOrName}`);
  const state = ScriptRunner.init(script, npc, target, args);
  if (target instanceof Player) state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  npc.executeScript(state);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} did not abort`);
  assert.equal(state.execution, ScriptState.FINISHED, `${script.name} finishes`);
  return state;
}
function runPureProc(name, args = []) {
  const script = ScriptProvider.getByName(name);
  assert(script, `packed pure proc ${name}`);
  const state = ScriptRunner.init(script, null, null, args);
  ScriptRunner.execute(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes`);
  return state.intStack.slice(0, state.isp);
}
// Keep the return-stack helper explicit so both the production script and the
// compiled return value are observed from the same execution.
function playerProcValue(player, name, args = [], target = null) {
  const state = runPlayerScript(player, `[proc,${name}]`, target, args);
  return state.intStack[state.isp - 1];
}
function withRandom(values, action) {
  const original = JavaRandom.nextDouble;
  let index = 0;
  JavaRandom.nextDouble = () => {
    assert(index < values.length, `unexpected random draw ${index + 1}; stream has ${values.length}`);
    return values[index++];
  };
  try {
    const result = action();
    assert.equal(index, values.length, 'the compiled script consumed exactly the supplied random stream');
    return result;
  } finally {
    JavaRandom.nextDouble = original;
  }
}
const randomValue = (exclusiveMax, wanted) => (wanted + 0.25) / exclusiveMax;
function watchPlayerScripts(player, action) {
  const original = player.executeScript;
  const names = [];
  player.executeScript = function (state, ...args) {
    names.push(state.script.name);
    return original.call(this, state, ...args);
  };
  try {
    action();
    return names;
  } finally {
    player.executeScript = original;
  }
}
function cardinalStand(loc, distance) {
  const candidates = [
    { level: loc.level, x: loc.x + distance, z: loc.z },
    { level: loc.level, x: loc.x - distance, z: loc.z },
    { level: loc.level, x: loc.x, z: loc.z + distance },
    { level: loc.level, x: loc.x, z: loc.z - distance }
  ];
  const stand = candidates.find(tile => map.isZoneAllocated(tile.level, tile.x, tile.z) &&
    !map.isMapBlocked(tile.x, tile.z, tile.level));
  assert(stand, `${loc.name ?? loc.type}: packed walkable cardinal stand at distance ${distance}`);
  return stand;
}
function useItemOnLoc(player, entry, itemId) {
  const slot = player.getInventory(inv).getItemIndex(itemId);
  assert(slot >= 0, `held inventory item ${itemId}`);
  player.originX = player.x;
  player.originZ = player.z;
  assert(locUseHandler.handle(new OpLocU(entry.loc.x, entry.loc.z, entry.loc.type, itemId, slot, invComponent), player),
    `production item-on-location packet accepted for ${entry.name}`);
  const opScript = player.getOpTrigger();
  const apScript = player.getApTrigger();
  assert(opScript, `production Player OPLOCU dispatch for ${entry.name}`);
  assert(apScript, `production Player APLOCU dispatch for ${entry.name}`);
  check(`${entry.name} production OPLOCU selector`, opScript.name, `[oplocu,${entry.name}]`);
  check(`${entry.name} production APLOCU selector`, apScript.name, `[aplocu,${entry.name}]`);
  const executed = watchPlayerScripts(player, () => player.processInteraction());
  return { opScript, apScript, executed };
}
function clickLocOption(player, entry, option) {
  player.originX = player.x;
  player.originZ = player.z;
  assert(locHandler.handle(new OpLoc(option, entry.loc.x, entry.loc.z, entry.loc.type), player),
    `production location option ${option} accepted for ${entry.name}`);
  const script = player.getOpTrigger();
  assert(script, `production Player OPLOC${option} dispatch for ${entry.name}`);
  const expected = `[oploc${option},${entry.name}]`;
  check(`${entry.name} option ${option} selected from packed loc`, script.name, expected);
  const approach = player.getApTrigger();
  assert(approach, `production Player APLOC${option} dispatch for ${entry.name}`);
  check(`${entry.name} coastal approach resolves from packed loc`, approach.name, `[aploc${option},${entry.name}]`);
  const executed = watchPlayerScripts(player, () => player.processInteraction());
  check(`${entry.name} option ${option} executes its production coastal approach`, executed.includes(approach.name), true);
  return executed;
}
function dispatchNoItemUse(player, entry) {
  // No OpLocU packet can name an empty inventory slot. Exercise the same real
  // Player selector with the production no-item sentinel for this branch.
  player.target = entry.loc;
  player.targetOp = ServerTriggerType.APLOCU;
  player.lastUseItem = -1;
  player.lastUseSlot = -1;
  const script = player.getOpTrigger();
  assert(script, `production no-item OPLOCU selector for ${entry.name}`);
  check(`${entry.name} no-item route selects packed OPLOCU`, script.name, `[oplocu,${entry.name}]`);
  return runPlayerScript(player, script, entry.loc);
}
function activeNpcs(type = null) {
  return [...World.npcs].filter(npc => npc.isActive && (type === null || npc.type === type));
}
function newMogres(before) {
  return activeNpcs(mogreNpcId).filter(npc => !before.has(npc.nid));
}
function addFixtureNpc(name, x, z, level = 0) {
  const type = NpcType.getByName(name);
  assert(type, `packed NPC fixture ${name}`);
  const npc = new Npc(level, x, z, type.size, type.size, EntityLifeCycle.RESPAWN,
    World.getNextNid(), type.id, type.blockwalk);
  World.addNpc(npc, -1);
  World.processNpcEventQueue();
  npc.lastMovement = World.currentTick - 100;
  return npc;
}
function productionAttack(player, npc) {
  player.level = npc.level;
  player.x = npc.x + npc.width;
  player.z = npc.z;
  player.originX = player.x;
  player.originZ = player.z;
  // Match OpNpcHandler's production interaction setup, including targetSubject.
  player.setInteraction(Interaction.ENGINE, npc, ServerTriggerType.APNPC2);
  const script = player.getOpTrigger();
  assert(script, 'production Player Attack trigger resolves');
  check('NPC Attack uses the ordinary packed OPNPC2 route', script.name, '[opnpc2,_]');
  const executed = watchPlayerScripts(player, () => player.processInteraction());
  check('production player interaction executes selected Attack route', executed.includes(script.name), true);
  return script;
}
function attackQueue(npc) {
  return [...npc.queue.all()].filter(request => request.queueId === ServerTriggerType.AI_QUEUE2);
}
function captureDrops(action, persist = true) {
  const drops = [];
  const original = World.addObj;
  World.addObj = function (obj, receiver, duration) {
    drops.push({ id: obj.type, count: obj.count });
    if (persist) return original.call(this, obj, receiver, duration);
    return undefined;
  };
  try {
    action();
    return drops;
  } finally {
    World.addObj = original;
  }
}
function drainNpc(npc, players, limit = 40) {
  for (let tick = 0; tick < limit; tick++) {
    if (npc.isActive) npc.turn();
    for (const player of players) player.processQueues();
    if (!npc.isActive && !npc.activeScript) {
      World.currentTick++;
      for (const player of players) player.processQueues();
      return;
    }
    World.currentTick++;
  }
  assert.fail(`Mogre ${npc.nid} did not finish its real damage/death queues within ${limit} ticks`);
}
function lethalDeath(npc, player) {
  const deathScript = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, mogreNpcType.id, mogreNpcType.category);
  assert(deathScript, 'packed Mogre AI_QUEUE3 dispatch by real NPC type/category');
  check('Mogre death dispatch selects its packed handler', deathScript.name, '[ai_queue3,mudskipper_ogre]');
  npc.heroPoints.addHero(player.hash64, npc.levels[NpcStat.HITPOINTS]);
  npc.setVar(ids.aggressivePlayer, player.uid);
  npc.setVar(ids.attackingUid, player.uid);
  runNpcScript(npc, '[proc,npc_default_damage]', player, [npc.levels[NpcStat.HITPOINTS]]);
  check('lethal production damage queues AI_QUEUE3',
    [...npc.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE3), true);
  return captureDrops(() => drainNpc(npc, [player]));
}

// The existing Skippy completion predicate stays false at 0..2 and true only at 3.
const skippyCheck = makePlayer({ slayer: 32, combat: 24, skippy: 0 });
for (let stage = 0; stage <= skippyComplete; stage++) {
  skippyCheck.setVarBit(skippyBit, stage);
  check(`slayer_skippy_unlocked at Skippy stage ${stage}`,
    playerProcValue(skippyCheck, 'slayer_skippy_unlocked'), Number(stage === skippyComplete));
  check(`validate_slayer_target Mogre at Skippy stage ${stage}`,
    playerProcValue(skippyCheck, 'validate_slayer_target', [mogreTaskValue]), Number(stage === skippyComplete));
}

// Actual base combat stats straddle the production combat-30 requirement.
const combatBoundary = makePlayer({ slayer: 32, combat: 23, skippy: skippyComplete });
check('combat stats produce level 29', playerProcValue(combatBoundary, 'player_combat_level'), 29);
check('Mogre assignment rejects combat 29',
  playerProcValue(combatBoundary, 'validate_slayer_target', [mogreTaskValue]), 0);
setCombatLevels(combatBoundary, 24);
check('combat stats produce level 30', playerProcValue(combatBoundary, 'player_combat_level'), 30);
check('Mogre assignment admits combat 30',
  playerProcValue(combatBoundary, 'validate_slayer_target', [mogreTaskValue]), 1);
combatBoundary.baseLevels[PlayerStat.SLAYER] = 31;
combatBoundary.levels[PlayerStat.SLAYER] = 31;
check('Mogre assignment rejects base Slayer 31',
  playerProcValue(combatBoundary, 'validate_slayer_target', [mogreTaskValue]), 0);
combatBoundary.baseLevels[PlayerStat.SLAYER] = 32;
combatBoundary.levels[PlayerStat.SLAYER] = 32;
check('Mogre assignment admits base Slayer 32',
  playerProcValue(combatBoundary, 'validate_slayer_target', [mogreTaskValue]), 1);

// Real Lure/Bait location packets reach the packed loc handlers and never summon.
for (const entry of locations) for (const option of [1, 2]) {
  // The original loc is offshore: its one-tile neighbours are blocked water.
  const p = makePlayer({ position: cardinalStand(entry.loc, 3) });
  const before = new Set(activeNpcs(mogreNpcId).map(npc => npc.nid));
  clickLocOption(p, entry, option);
  check(`${entry.name} option ${option} shows the sourced empty-fishing reaction`,
    allText(p).includes(fishingEmptyText), true);
  check(`${entry.name} option ${option} never summons a Mogre`, newMogres(before).length, 0);
  check(`${entry.name} option ${option} does not use an explosive`, count(p, ids.fishingExplosive), 0);
}

// A wrong held item and the no-item sentinel both stay inert through the real
// packed Player selector; neither can consume or summon.
{
  const entry = locations[0];
  const p = makePlayer({ position: cardinalStand(entry.loc, 3) });
  give(p, ids.hammer);
  const before = new Set(activeNpcs(mogreNpcId).map(npc => npc.nid));
  const routes = useItemOnLoc(p, entry, ids.hammer);
  check(`${entry.name} item-use packet executes APLOCU from the actual shore`,
    routes.executed.includes('[aplocu,ominous_fishing_spot_a]'), true);
  check('unrelated item remains in inventory', count(p, ids.hammer), 1);
  check('unrelated item does not consume an explosive', count(p, ids.fishingExplosive), 0);
  check('unrelated item does not summon', newMogres(before).length, 0);
}
{
  const entry = locations[0];
  const p = makePlayer({ position: cardinalStand(entry.loc, 3) });
  const before = new Set(activeNpcs(mogreNpcId).map(npc => npc.nid));
  dispatchNoItemUse(p, entry);
  check('no-item route consumes no explosive', count(p, ids.fishingExplosive), 0);
  check('no-item route does not summon', newMogres(before).length, 0);
}

// Incomplete Skippy explicitly refuses and preserves both explosives.
{
  const entry = locations[0];
  const p = makePlayer({ slayer: 32, combat: 24, skippy: skippyComplete - 1,
    position: cardinalStand(entry.loc, 3) });
  give(p, ids.fishingExplosive, 2);
  const before = new Set(activeNpcs(mogreNpcId).map(npc => npc.nid));
  useItemOnLoc(p, entry, ids.fishingExplosive);
  check('incomplete Skippy gate displays its exact refusal', allText(p).includes(incompleteText), true);
  check('incomplete Skippy gate consumes no explosives', count(p, ids.fishingExplosive), 2);
  check('incomplete Skippy gate spawns no Mogre', newMogres(before).length, 0);
}

// Two-tile safety boundary refuses; beyond it, the three real locs summon at
// their checked fixed origins. Distance six is admitted, distance seven only
// changes the AP range and consumes nothing.
{
  const entry = locations[0];
  const p = makePlayer({ position: cardinalStand(entry.loc, unsafeRange) });
  give(p, ids.fishingExplosive, 1);
  const before = new Set(activeNpcs(mogreNpcId).map(npc => npc.nid));
  const routes = useItemOnLoc(p, entry, ids.fishingExplosive);
  check(`${entry.name} distance ${unsafeRange} executes APLOCU`,
    routes.executed.includes('[aplocu,ominous_fishing_spot_a]'), true);
  check('two-tile unsafe boundary displays the exact warning', allText(p).includes(tooCloseText), true);
  check('two-tile unsafe boundary consumes nothing', count(p, ids.fishingExplosive), 1);
  check('two-tile unsafe boundary spawns nothing', newMogres(before).length, 0);
}
{
  const entry = locations[0];
  const p = makePlayer({ position: cardinalStand(entry.loc, throwRange + 1) });
  give(p, ids.fishingExplosive, 1);
  const before = new Set(activeNpcs(mogreNpcId).map(npc => npc.nid));
  const routes = useItemOnLoc(p, entry, ids.fishingExplosive);
  check(`${entry.name} far item use executes APLOCU`, routes.executed.includes('[aplocu,ominous_fishing_spot_a]'), true);
  check('far item use sets the packed AP approach range', p.apRange, throwRange);
  check('far item use consumes nothing', count(p, ids.fishingExplosive), 1);
  check('far item use spawns nothing', newMogres(before).length, 0);
}

function assertSummon(entry, { distance, taskTarget = 0, taskCount = 0, explosives = 1 } = {}) {
  const p = makePlayer({ slayer: 32, combat: 24, skippy: skippyComplete, taskTarget, taskCount,
    position: cardinalStand(entry.loc, distance) });
  give(p, ids.fishingExplosive, explosives);
  const before = new Set(activeNpcs(mogreNpcId).map(npc => npc.nid));
  const routes = useItemOnLoc(p, entry, ids.fishingExplosive);
  check(`${entry.name} success executes APLOCU approach route`,
    routes.executed.includes(`[aplocu,${entry.name}]`), true);
  const spawned = newMogres(before);
  check(`${entry.name} success creates exactly one packed Mogre`, spawned.length, 1);
  const npc = spawned[0];
  // World.addNpc queues AI_SPAWN separately from Npc.turn; run that real phase.
  World.processNpcEventQueue();
  check(`${entry.name} summoned Mogre uses its constant landing`, [npc.level, npc.x, npc.z],
    [entry.landing.level, entry.landing.x, entry.landing.z]);
  check(`${entry.name} summoned Mogre occupies the packed 2x2 size`, [npc.width, npc.length], [2, 2]);
  check(`${entry.name} summoned Mogre starts at packed hitpoints`, npc.levels[NpcStat.HITPOINTS], 48);
  check(`${entry.name} successful throw consumes exactly one explosive`,
    count(p, ids.fishingExplosive), explosives - 1);
  check(`${entry.name} summoned Mogre has finite despawn lifecycle`, npc.lifecycle, EntityLifeCycle.DESPAWN);
  check(`${entry.name} summoned Mogre lifetime comes from checked constant`, npc.lifecycleTick, lifetime);
  check(`${entry.name} summoned Mogre uses the active summoner as its target`, npc.target === p, true);
  check(`${entry.name} summoned Mogre uses OPPLAYER2 aggression`, npc.targetOp, NpcMode.OPPLAYER2);
  check(`${entry.name} summoned Mogre says one checked transcript line`,
    mogreSayings.includes(npc.sayMessage), true);
  return { player: p, npc };
}

// No task is required to summon. Two explosives prove exact one-item settlement.
const noTaskSummon = assertSummon(locations[0], { distance: 3, explosives: 2 });

// The incomplete quest gate is isolated to Mogres; ordinary cow Attack remains available.
{
  const p = makePlayer({ slayer: 32, combat: 24, skippy: skippyComplete - 1,
    position: { level: noTaskSummon.npc.level, x: noTaskSummon.npc.x + noTaskSummon.npc.width, z: noTaskSummon.npc.z } });
  give(p, id('ObjType', 'bronze_scimitar'));
  p.getInventory(id('InvType', 'worn')).set(3, { id: id('ObjType', 'bronze_scimitar'), count: 1 });
  runPlayerScript(p, '[proc,player_combat_stat]');
  const beforeHp = noTaskSummon.npc.levels[NpcStat.HITPOINTS];
  productionAttack(p, noTaskSummon.npc);
  check('unfinished Skippy cannot queue damage against another player\'s Mogre', attackQueue(noTaskSummon.npc).length, 0);
  check('unfinished Skippy leaves another summoner\'s Mogre HP unchanged',
    noTaskSummon.npc.levels[NpcStat.HITPOINTS], beforeHp);

  const cow = addFixtureNpc('cow', noTaskSummon.npc.x + 8, noTaskSummon.npc.z);
  p.x = cow.x + cow.width; p.z = cow.z; p.level = cow.level;
  const cowQueueBefore = attackQueue(cow).length;
  productionAttack(p, cow);
  check('unfinished-Skippy control player can Attack an ordinary cow', attackQueue(cow).length > cowQueueBefore, true);
  World.removeNpc(cow, -1);
}

// Production Attack checks both the normal combat level and the Mogre Slayer level.
for (const slayer of [31, 32]) {
  const p = makePlayer({ slayer, combat: 24, skippy: skippyComplete });
  const npc = addFixtureNpc('mudskipper_ogre', noTaskSummon.npc.x + 8 + slayer, noTaskSummon.npc.z + 8);
  const bronzeScimitar = id('ObjType', 'bronze_scimitar');
  p.getInventory(id('InvType', 'worn')).set(3, { id: bronzeScimitar, count: 1 });
  runPlayerScript(p, '[proc,player_combat_stat]');
  const hp = npc.levels[NpcStat.HITPOINTS];
  productionAttack(p, npc);
  if (slayer === 31) {
    check('production Slayer 31 Attack displays the exact Mogre level refusal',
      allText(p).includes('You need a higher Slayer level to know how to wound this monster.'), true);
    check('production Slayer 31 Attack queues no NPC damage', attackQueue(npc).length, 0);
    check('production Slayer 31 Attack leaves Mogre HP intact', npc.levels[NpcStat.HITPOINTS], hp);
  } else {
    check('production Slayer 32 Attack queues the real NPC damage event', attackQueue(npc).length > 0, true);
  }
  World.removeNpc(npc, -1);
}

// Real AI_QUEUE3 death after real npc_default_damage: task progress is once, in tenths,
// and the ordinary no-task case still receives bones and the common roll.
const noTaskXp = noTaskSummon.player.stats[PlayerStat.SLAYER];
const noTaskDrops = lethalDeath(noTaskSummon.npc, noTaskSummon.player);
check('no-task Mogre death removes the summoned NPC', noTaskSummon.npc.isActive, false);
check('no-task Mogre death awards no Slayer XP', noTaskSummon.player.stats[PlayerStat.SLAYER] - noTaskXp, 0);
check('no-task Mogre death changes no Slayer count', noTaskSummon.player.getVar(ids.slayerCount), 0);
check('no-task Mogre death always drops one big bones',
  noTaskDrops.some(drop => drop.id === ids.bigBones && drop.count === 1), true);

const matching = assertSummon(locations[1], { distance: throwRange, taskTarget: mogreTaskValue, taskCount: 1 });
const matchingXp = matching.player.stats[PlayerStat.SLAYER];
const matchingDrops = lethalDeath(matching.npc, matching.player);
check('matching Mogre death decrements exactly one task', matching.player.getVar(ids.slayerCount), 0);
check('matching Mogre death awards 480 Slayer XP tenths',
  matching.player.stats[PlayerStat.SLAYER] - matchingXp, 480);
check('matching Mogre death always drops one big bones',
  matchingDrops.some(drop => drop.id === ids.bigBones && drop.count === 1), true);

const nonmatching = assertSummon(locations[2], { distance: 3,
  taskTarget: numericConstant(taskConstants, 'slayer_rat'), taskCount: 3 });
const nonmatchingXp = nonmatching.player.stats[PlayerStat.SLAYER];
const nonmatchingDrops = lethalDeath(nonmatching.npc, nonmatching.player);
check('nonmatching Mogre death does not decrement another task', nonmatching.player.getVar(ids.slayerCount), 3);
check('nonmatching Mogre death awards no Slayer XP',
  nonmatching.player.stats[PlayerStat.SLAYER] - nonmatchingXp, 0);
check('nonmatching Mogre death still drops one big bones',
  nonmatchingDrops.some(drop => drop.id === ids.bigBones && drop.count === 1), true);

// A second live summon proves lifecycle expiry through real Npc.turn ticks.
const expiring = assertSummon(locations[2], { distance: 3 });
expiring.npc.clearInteraction();
expiring.npc.target = null;
expiring.npc.targetOp = NpcMode.NONE;
expiring.npc.setVar(ids.aggressivePlayer, 0);
for (let tick = 0; tick < lifetime - 1; tick++) {
  World.currentTick++;
  expiring.npc.turn();
}
check('summoned Mogre remains active until its finite lifetime ends', expiring.npc.isActive, true);
World.currentTick++;
expiring.npc.turn();
check('summoned Mogre despawns on its finite lifecycle deadline', expiring.npc.isActive, false);

// Exhaust every compiled 128-slot common-table result, including its empty final slot.
// The helper branch receives a deterministic first uncommon seed from the real helper.
const commonBands = [
  [0, 4, 'waterrune', 5], [4, 8, 'waterrune', 7], [8, 12, 'waterrune', 14],
  [12, 25, 'limpwurt_seed', 1], [25, 45, 'raw_swordfish', 1], [45, 54, 'raw_tuna', 1],
  [54, 61, 'raw_pike', 1], [61, 65, 'raw_salmon', 1], [65, 68, 'raw_herring', 1],
  [68, 71, 'raw_sardine', 1], [71, 74, 'raw_shark', 1], [74, 104, 'fishing_bait', 5],
  [104, 114, 'fishing_bait', 15], [114, 119, 'mudskipper_hat', 1], [119, 122, 'oystershell', 1],
  [122, 123, 'mudskipper_flippers', 1], [123, 125, 'seaweed', 1], [125, 126, 'staff_of_water', 1],
  [126, 127, 'fishbowl_water', 1], [127, 128, null, 0]
];
check('Mogre common table bands cover all 128 source slots', commonBands.at(-1)[1], 128);
check('Mogre retains exactly one common flipper slot',
  commonBands.filter(([, , name]) => name === 'mudskipper_flippers').reduce((sum, [start, end]) => sum + end - start, 0), 1);
const tableNpc = expiring.npc;
for (let roll = 0; roll < 128; roll++) {
  const band = commonBands.find(([start, end]) => roll >= start && roll < end);
  assert(band, `common drop roll ${roll} has one declared result`);
  const values = [randomValue(128, roll)];
  if (band[2] === 'limpwurt_seed') values.push(randomValue(998, 0));
  const drops = captureDrops(() => withRandom(values, () => runNpcScript(tableNpc, '[proc,mogre_drop]', expiring.player)), false);
  const expected = band[2] === null ? [] : [{ id: id('ObjType', band[2]), count: band[3] }];
  check(`compiled Mogre common drop roll ${roll}`, drops, expected);
}

// Every outcome of the existing 998-weight uncommon seed helper is exercised
// through its packed compiled proc; no bytecode or recorded trace is compared.
const uncommonSeeds = [
  ['limpwurt_seed', 134], ['strawberry_seed', 131], ['marrentill_seed', 123],
  ['jangerberry_bush_seed', 94], ['tarromin_seed', 84], ['wildblood_hop_seed', 83],
  ['watermelon_seed', 63], ['harralander_seed', 58], ['ranarr_seed', 40],
  ['whiteberry_bush_seed', 34], ['mushroom_seed', 29], ['toadflax_seed', 27],
  ['belladonna_seed', 18], ['irit_seed', 18], ['poisonivy_bush_seed', 13],
  ['avantoe_seed', 12], ['cactus_seed', 12], ['kwuarm_seed', 9], ['snapdragon_seed', 6],
  ['cadantine_seed', 4], ['lantadyme_seed', 3], ['dwarf_weed_seed', 2], ['torstol_seed', 1]
];
const uncommonTotal = uncommonSeeds.reduce((sum, [, weight]) => sum + weight, 0);
check('existing uncommon seed table cumulative range', uncommonTotal, 998);
let seedStart = 0;
for (const [name, weight] of uncommonSeeds) {
  for (let roll = seedStart; roll < seedStart + weight; roll++) {
    const stack = withRandom([randomValue(uncommonTotal, roll)],
      () => runPureProc('[proc,roll_uncommon_seed_table]'));
    check(`compiled uncommon seed roll ${roll} returns ${name} x1`, stack, [id('ObjType', name), 1]);
  }
  seedStart += weight;
}

// CANDIDATE Mogre immunity is checked while Skippy is complete, so the separate
// owner gate cannot explain it. A packed ordinary cow remains poisonable.
{
  const player = makePlayer({ slayer: 32, combat: 24, skippy: skippyComplete });
  const origin = locations[0].landing;
  const mogre = addFixtureNpc('mudskipper_ogre', origin.x + 8, origin.z + 8, origin.level);
  const cow = addFixtureNpc('cow', origin.x + 12, origin.z + 8, origin.level);
  const poisonStart = ScriptProvider.getByName('[proc,npc_poison_start]');
  assert(poisonStart, 'packed npc_poison_start proc');
  runNpcScript(mogre, poisonStart, player, [6]);
  check('completed-player Mogre remains poison immune', mogre.getVar(ids.poison), 0);
  runNpcScript(cow, poisonStart, player, [6]);
  check('ordinary cow control still receives production poison', cow.getVar(ids.poison), 6);
  World.removeNpc(mogre, -1);
  World.removeNpc(cow, -1);
}

console.log(`PASS Mogre compiled runtime ${assertions} assertions`);
process.exit(0);
