/**
 * Execute Brimhaven Dungeon's packed production triggers without a server.
 * Run from the sibling engine after the full content pack is built:
 *   node --import tsx ../content/tests/brim-dungeon/test_brim_dungeon.mjs
 * BRIM_SCRIPT_PACK_DIR can select a comparison script pack. Configs and maps
 * always load from the normal engine pack.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_DIR, '../engine');
const PACK_DIR = path.join(ENGINE_DIR, 'data/pack');
const SCRIPT_PACK_DIR = process.env.BRIM_SCRIPT_PACK_DIR ?? PACK_DIR;
process.chdir(ENGINE_DIR);
const eng = rel => import(pathToFileURL(path.join(ENGINE_DIR, rel)).href);

const { default: World } = await eng('src/engine/World.ts');
const { default: Player } = await eng('src/engine/entity/Player.ts');
const { default: Npc } = await eng('src/engine/entity/Npc.ts');
const { default: Loc } = await eng('src/engine/entity/Loc.ts');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStatMap } = await eng('src/engine/entity/PlayerStat.ts');
const { default: ScriptProvider } = await eng('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('src/engine/script/ScriptState.ts');
const { default: ServerTriggerType } = await eng('src/engine/script/ServerTriggerType.ts');
const { default: Environment } = await eng('src/util/Environment.ts');
const { default: Packet } = await eng('src/io/Packet.ts');
const { default: JavaRandom } = await eng('src/util/JavaRandom.ts');
const { default: routefinder, CollisionFlag } = await eng('src/engine/routefinder/index.ts');
const { unzipSync } = createRequire(path.join(ENGINE_DIR, 'package.json'))('fflate');

const config = {};
for (const name of [
  'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType',
  'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component',
  'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType',
  'MesanimType', 'IdkType', 'HuntType'
]) {
  config[name] = (await eng(`src/cache/config/${name}.ts`)).default;
  config[name].load(PACK_DIR);
}
const ScriptVarType = (await eng('src/cache/config/ScriptVarType.ts')).default;
(await eng('src/cache/config/DbTableIndex.ts')).default.init();

Environment.NODE_XPRATE = 1;
Environment.NODE_DEBUG = false;
Environment.NODE_MEMBERS = true;
World.currentTick = 100;
World.vars = Int32Array.from({ length: config.VarSharedType.count }, (_, id) =>
  config.VarSharedType.get(id).type === ScriptVarType.INT ? 0 : -1
);
World.varsString = new Array(config.VarSharedType.count);
assert(ScriptProvider.load(SCRIPT_PACK_DIR) > 0, 'a complete packed server script cache is required');
World.gameMap.init();
assert(World.gameMap.getTotalLocs() > 0, 'the packed world map loaded static locations');

const packIdCache = new Map();
function packId(kind, name) {
  if (!packIdCache.has(kind)) {
    const file = path.join(CONTENT_DIR, `pack/${kind}.pack`);
    const ids = new Map();
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at < 0) continue;
      ids.set(line.slice(at + 1).trim(), Number(line.slice(0, at)));
    }
    packIdCache.set(kind, ids);
  }
  const id = packIdCache.get(kind).get(name);
  assert(Number.isInteger(id), `${kind}.pack is missing ${name}`);
  return id;
}

const MAP_LOCS = [
  { name: 'dungeon_tree_closed', id: 5083, placements: [{ level: 0, effectiveLevel: 0, x: 2743, z: 3153 }] },
  { name: 'karam_dungeon_exit', id: 5084, placements: [{ level: 0, effectiveLevel: 0, x: 2714, z: 9564 }] },
  { name: 'karam_dungeon_bamboo_logbalance1', id: 5088, placements: [{ level: 1, effectiveLevel: 0, x: 2683, z: 9506 }] },
  { name: 'karam_dungeon_bamboo_logbalance3', id: 5090, placements: [{ level: 1, effectiveLevel: 0, x: 2686, z: 9506 }] },
  { name: 'pipe', id: 5099, placements: [
    { level: 0, effectiveLevel: 0, x: 2698, z: 9493 },
    { level: 0, effectiveLevel: 0, x: 2698, z: 9498 }
  ] },
  { name: 'pipe_5100', id: 5100, placements: [
    { level: 0, effectiveLevel: 0, x: 2655, z: 9567 },
    { level: 0, effectiveLevel: 0, x: 2655, z: 9571 }
  ] },
  { name: 'karam_dungeon_vineblocking1', id: 5103, placements: [{ level: 0, effectiveLevel: 0, x: 2690, z: 9564 }] },
  { name: 'karam_dungeon_vineblocking2', id: 5104, placements: [{ level: 0, effectiveLevel: 0, x: 2683, z: 9569 }] },
  { name: 'karam_dungeon_vineblocking3', id: 5105, placements: [{ level: 0, effectiveLevel: 0, x: 2673, z: 9499 }] },
  { name: 'karam_dungeon_vineblocking4', id: 5106, placements: [{ level: 0, effectiveLevel: 0, x: 2675, z: 9479 }] },
  { name: 'karam_dungeon_vineblocking5', id: 5107, placements: [{ level: 0, effectiveLevel: 0, x: 2694, z: 9482 }] },
  { name: 'karam_dungeon_stone1', id: 5110, placements: [{ level: 0, effectiveLevel: 0, x: 2649, z: 9561 }] },
  { name: 'karam_dungeon_stone2', id: 5111, placements: [{ level: 0, effectiveLevel: 0, x: 2647, z: 9558 }] }
];
for (const row of MAP_LOCS) {
  assert.equal(packId('loc', row.name), row.id, `${row.name} retains its 377 loc id`);
}
assert.equal(packId('varp', 'karam_dungeon_varbit'), 393, 'the paid-entry state uses existing permanent varp 393');
assert.equal(packId('loc', 'pipe'), 5099, 'pipe resolves by its authored config name');
assert.equal(packId('loc', 'pipe_5100'), 5100, 'the second pipe resolves by its authored config name');

function readPackedMapPlacements() {
  const archive = path.join(PACK_DIR, '.cache/maps-server.zip');
  assert(fs.existsSync(archive), 'the full compiled maps-server.zip is required');
  const entries = unzipSync(fs.readFileSync(archive));
  const expectedById = new Map(MAP_LOCS.map(row => [row.id, row]));
  const found = new Map(MAP_LOCS.map(row => [row.name, []]));
  const mapFiles = Object.entries(entries).filter(([name]) => /^l\d+_\d+$/.test(name));
  assert(mapFiles.length > 0, 'the packed map archive has no loc maps');
  for (const [name, bytes] of mapFiles) {
    const [, mapX, mapZ] = name.match(/^l(\d+)_(\d+)$/);
    const packet = new Packet(bytes);
    let locId = -1;
    while (packet.available > 0) {
      const locOffset = packet.gsmarts();
      if (locOffset === 0) break;
      locId += locOffset;
      let coord = 0;
      let coordOffset = packet.gsmarts();
      while (coordOffset !== 0) {
        coord += coordOffset - 1;
        const info = packet.g1();
        const expected = expectedById.get(locId);
        if (expected) {
          found.get(expected.name).push({
            level: (coord >> 12) & 3,
            effectiveLevel: (coord >> 12) & 3,
            x: (Number(mapX) << 6) + ((coord >> 6) & 63),
            z: (Number(mapZ) << 6) + (coord & 63),
            shape: info >> 2,
            angle: info & 3
          });
        }
        coordOffset = packet.gsmarts();
      }
    }
    assert.equal(packet.available, 0, `${name} loc stream is fully consumed`);
  }
  const placements = new Map();
  for (const row of MAP_LOCS) {
    const actual = found.get(row.name).sort((a, b) => a.level - b.level || a.x - b.x || a.z - b.z);
    const expected = row.placements.map(({ level, x, z }) => ({ level, x, z })).sort((a, b) => a.level - b.level || a.x - b.x || a.z - b.z);
    assert.deepEqual(actual.map(({ level, x, z }) => ({ level, x, z })), expected, `${row.name} has exactly the expected packed map placements`);
    placements.set(row.name, actual.map((entry, index) => ({ ...entry, effectiveLevel: row.placements[index].effectiveLevel })));
  }
  return placements;
}
const MAP_PLACEMENTS = readPackedMapPlacements();

function mapPlacement(name, x, z) {
  const placement = MAP_PLACEMENTS.get(name).find(entry => entry.x === x && entry.z === z);
  assert(placement, `${name} is placed at ${x},${z}`);
  return placement;
}
function detachedLoc(name, x, z) {
  const placement = mapPlacement(name, x, z);
  const id = packId('loc', name);
  const type = config.LocType.get(id);
  assert(type, `${name} LocType is loaded`);
  return new Loc(
    placement.effectiveLevel,
    placement.x,
    placement.z,
    type.width,
    type.length,
    EntityLifeCycle.RESPAWN,
    id,
    placement.shape,
    placement.angle
  );
}
function activeLoc(name, x, z) {
  const placement = mapPlacement(name, x, z);
  const loc = World.getLoc(x, z, placement.effectiveLevel, packId('loc', name));
  assert(loc, `${name} is present in the effective packed world map`);
  return loc;
}

const VINES = [
  { name: 'karam_dungeon_vineblocking1', level: 10, placement: [2690, 9564], start: { level: 0, x: 2691, z: 9564 }, end: { level: 0, x: 2689, z: 9564 } },
  { name: 'karam_dungeon_vineblocking2', level: 27, placement: [2683, 9569], start: { level: 0, x: 2683, z: 9568 }, end: { level: 0, x: 2683, z: 9570 } },
  { name: 'karam_dungeon_vineblocking3', level: 22, placement: [2673, 9499], start: { level: 0, x: 2672, z: 9499 }, end: { level: 0, x: 2674, z: 9499 } },
  { name: 'karam_dungeon_vineblocking4', level: 34, placement: [2675, 9479], start: { level: 0, x: 2674, z: 9479 }, end: { level: 0, x: 2676, z: 9479 } },
  { name: 'karam_dungeon_vineblocking5', level: 34, placement: [2694, 9482], start: { level: 0, x: 2693, z: 9482 }, end: { level: 0, x: 2695, z: 9482 } }
];
const AGILITY_OBSTACLES = [
  { name: 'karam_dungeon_stone1', placement: [2649, 9561], start: { level: 0, x: 2649, z: 9562 }, end: { level: 0, x: 2647, z: 9557 }, fail: { level: 0, x: 2648, z: 9562 }, requirement: 12, xp: 75 },
  { name: 'karam_dungeon_stone2', placement: [2647, 9558], start: { level: 0, x: 2647, z: 9557 }, end: { level: 0, x: 2649, z: 9562 }, fail: { level: 0, x: 2648, z: 9557 }, xp: 75 },
  { name: 'karam_dungeon_bamboo_logbalance1', placement: [2683, 9506], start: { level: 0, x: 2682, z: 9506 }, end: { level: 0, x: 2687, z: 9506 }, fail: { level: 0, x: 2681, z: 9507 }, requirement: 22, xp: 100 },
  { name: 'karam_dungeon_bamboo_logbalance3', placement: [2686, 9506], start: { level: 0, x: 2687, z: 9506 }, end: { level: 0, x: 2682, z: 9506 }, fail: { level: 0, x: 2688, z: 9508 }, xp: 100 }
];
const PIPES = [
  {
    name: 'pipe', placement: [2698, 9493], lock: 'karam_dungeon_pipe_used2', xp: 100,
    forward: { side: 'north', requirement: 34, start: { level: 0, x: 2698, z: 9500 }, end: { level: 0, x: 2698, z: 9492 } },
    reverse: { side: 'south', start: { level: 0, x: 2698, z: 9492 }, end: { level: 0, x: 2698, z: 9500 } }
  },
  {
    name: 'pipe_5100', placement: [2655, 9567], lock: 'karam_dungeon_pipe_used', xp: 85,
    forward: { side: 'south', requirement: 22, start: { level: 0, x: 2655, z: 9566 }, end: { level: 0, x: 2655, z: 9573 } },
    reverse: { side: 'north', start: { level: 0, x: 2655, z: 9573 }, end: { level: 0, x: 2655, z: 9566 } }
  }
];

const walkableTiles = [
  { level: 0, x: 2713, z: 9564, label: 'entrance landing' },
  { level: 0, x: 2745, z: 3152, label: 'exit landing' },
  ...VINES.flatMap(vine => [
    { ...vine.start, label: `${vine.name} donor start` },
    { ...vine.end, label: `${vine.name} donor landing` }
  ]),
  ...AGILITY_OBSTACLES.flatMap(obstacle => [
    { ...obstacle.start, label: `${obstacle.name} start` },
    { ...obstacle.end, label: `${obstacle.name} success landing` },
    { ...obstacle.fail, label: `${obstacle.name} failure landing` }
  ]),
  ...PIPES.flatMap(pipe => [
    { ...pipe.forward.start, label: `${pipe.name} ${pipe.forward.side} start` },
    { ...pipe.forward.end, label: `${pipe.name} ${pipe.forward.side} landing` },
    { ...pipe.reverse.start, label: `${pipe.name} ${pipe.reverse.side} start` },
    { ...pipe.reverse.end, label: `${pipe.name} ${pipe.reverse.side} landing` }
  ])
];
for (const tile of walkableTiles) {
  assert.equal(routefinder.isFlagged(tile.x, tile.z, tile.level, CollisionFlag.WALK_BLOCKED), false, `${tile.label} is walkable in packed World.gameMap collision`);
}
for (const row of MAP_LOCS) {
  for (const placement of MAP_PLACEMENTS.get(row.name)) {
    assert(World.getLoc(placement.x, placement.z, placement.effectiveLevel, row.id), `${row.name} exists on effective plane ${placement.effectiveLevel}`);
  }
}

const AGILITY = PlayerStatMap.get('AGILITY');
const WOODCUTTING = PlayerStatMap.get('WOODCUTTING');
const HITPOINTS = PlayerStatMap.get('HITPOINTS');
assert(Number.isInteger(AGILITY) && Number.isInteger(WOODCUTTING) && Number.isInteger(HITPOINTS), 'Agility, Woodcutting and Hitpoints stats are loaded');
const INV = packId('inv', 'inv');
const COINS = packId('obj', 'coins');
const BRONZE_AXE = packId('obj', 'bronze_axe');
const PAID_FLAG = packId('varp', 'karam_dungeon_varbit');
const ACTION_DELAY = packId('varp', 'action_delay');
const NEXT_TICK = () => (World.currentTick += 100);
let nextPlayerId = 1;

function makePlayer({ tile, agility = 1, woodcutting = 1, hitpoints = 90, coins = 0, axe = false }) {
  const serial = nextPlayerId++;
  const player = new Player(`brim_dungeon_${serial}`, BigInt(serial), BigInt(1000 + serial));
  player.uid = ((Number(player.username37 & 0x1fffffn) << 11) | serial) >>> 0;
  player.pid = serial;
  player.slot = serial;
  World.players[serial] = player;
  player.packets = [];
  player.messages = [];
  player.write = packet => player.packets.push(packet);
  player.messageGame = message => player.messages.push(message);
  player.wrappedMessageGame = message => player.messages.push(message);
  player.vars.fill(0);
  player.stats.fill(0);
  player.setLevel(AGILITY, agility);
  player.setLevel(WOODCUTTING, woodcutting);
  player.setLevel(HITPOINTS, hitpoints);
  player.level = tile.level;
  player.x = tile.x;
  player.z = tile.z;
  player.lastMovement = 0;
  const inventory = player.getInventory(INV);
  if (coins > 0) inventory.add(COINS, coins);
  if (axe) inventory.add(BRONZE_AXE, 1);
  return player;
}
function tileOf(player) {
  return { level: player.level, x: player.x, z: player.z };
}
function skillXp(player, skill) {
  return player.stats[skill];
}
function requireTrigger(type, id, name) {
  const trigger = ScriptProvider.getByTriggerSpecific(type, id);
  assert(trigger, `${name} is a packed production trigger`);
  assert.equal(trigger.name, name);
  assert.equal(trigger.fileName, 'karam_dungeon.rs2');
  return trigger;
}
function startScript(player, script, target = null) {
  const state = ScriptRunner.init(script, player, target);
  player.executeScript(state, true, true);
  return { state, result: state.execution };
}
function finishDelayed(player) {
  let boundaries = 0;
  while (player.activeScript) {
    assert.ok(boundaries++ < 100, 'each packed dungeon obstacle has a finite delay schedule');
    const state = player.activeScript;
    if (state.execution === ScriptState.SUSPENDED) {
      assert(player.delayed, 'the player remains delayed while the active script is suspended');
      assert(Number.isFinite(player.delayedUntil), 'the delayed tick is numeric');
      World.currentTick = Math.max(World.currentTick, player.delayedUntil);
      player.delayed = false;
    } else {
      assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'only normal dialogue continuation may resume without a delay');
    }
    player.executeScript(state, true, true);
  }
  assert.equal(player.delayed, false, 'all scheduled dungeon delays are drained');
}
function runToCompletion(player, script, target = null) {
  const { state, result } = startScript(player, script, target);
  assert.notEqual(result, ScriptState.ABORTED, `${script.name} does not abort`);
  if (player.activeScript) finishDelayed(player);
  assert.equal(state.execution, ScriptState.FINISHED, `${script.name} finishes`);
  assert.equal(player.activeScript, null, `${script.name} leaves no active script`);
  return state;
}
function withRandom(value, callback) {
  const original = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => value;
  try {
    return callback();
  } finally {
    JavaRandom.nextDouble = original;
  }
}

const doormanId = packId('npc', 'tribesman_doorman');
const payTrigger = requireTrigger(ServerTriggerType.OPNPC3, doormanId, '[opnpc3,tribesman_doorman]');
const entryId = packId('loc', 'dungeon_tree_closed');
const exitId = packId('loc', 'karam_dungeon_exit');
const entryTrigger = requireTrigger(ServerTriggerType.OPLOC1, entryId, '[oploc1,dungeon_tree_closed]');
const exitTrigger = requireTrigger(ServerTriggerType.OPLOC1, exitId, '[oploc1,karam_dungeon_exit]');
const openEntry = ScriptProvider.getByName('[oploc1,dungeon_tree_open]');
assert(openEntry, 'the opened entrance also has a packed trigger');
assert.equal(openEntry.fileName, 'karam_dungeon.rs2');

function coinCount(player) {
  return player.getInventory(INV).getItemCount(COINS);
}
function doorman() {
  const type = config.NpcType.get(doormanId);
  assert(type, 'Saniboch NpcType is loaded');
  return new Npc(0, 2744, 3153, type.size, type.size, EntityLifeCycle.RESPAWN, nextPlayerId, doormanId, type.blockwalk);
}
for (const amount of [0, 874]) {
  const player = makePlayer({ tile: { level: 0, x: 2742, z: 3153 }, coins: amount });
  const before = coinCount(player);
  runToCompletion(player, payTrigger, doorman());
  assert.equal(coinCount(player), before, `Saniboch refuses ${amount} coins without a deduction`);
  assert.equal(player.getVar(PAID_FLAG), 0, 'a refused payment does not set the existing paid-entry varp');
}
const payer = makePlayer({ tile: { level: 0, x: 2742, z: 3153 }, coins: 875 });
runToCompletion(payer, payTrigger, doorman());
assert.equal(coinCount(payer), 0, 'Pay deducts exactly 875 coins');
assert.equal(payer.getVar(PAID_FLAG), 1, 'Pay sets existing varp 393');
payer.getInventory(INV).add(COINS, 875);
runToCompletion(payer, payTrigger, doorman());
assert.equal(coinCount(payer), 875, 'Pay does not charge again while the flag is set');
assert.equal(payer.getVar(PAID_FLAG), 1, 'repeat Pay preserves the paid-entry flag');
console.log('PASS Saniboch exact payment, refusal and repeat payment');

const entranceStand = { level: 0, x: 2742, z: 3153 };
const unpaidEntrant = makePlayer({ tile: entranceStand });
const closedEntrance = activeLoc('dungeon_tree_closed', 2743, 3153);
runToCompletion(unpaidEntrant, entryTrigger, closedEntrance);
assert.deepEqual(tileOf(unpaidEntrant), entranceStand, 'the unpaid entrance does not move the player');
assert.equal(unpaidEntrant.getVar(PAID_FLAG), 0, 'the unpaid entrance leaves the flag clear');
const paidEntryLoc = activeLoc('dungeon_tree_closed', 2743, 3153);
runToCompletion(payer, entryTrigger, paidEntryLoc);
assert.deepEqual(tileOf(payer), { level: 0, x: 2713, z: 9564 }, 'paid entry lands at the donor dungeon coordinate');
assert.equal(payer.getVar(PAID_FLAG), 0, 'entry consumes the paid-entry flag');
assert.equal(coinCount(payer), 875, 'entry does not charge coins a second time');
const exitLoc = activeLoc('karam_dungeon_exit', 2714, 9564);
runToCompletion(payer, exitTrigger, exitLoc);
assert.deepEqual(tileOf(payer), { level: 0, x: 2745, z: 3152 }, 'the exit returns to the donor surface coordinate');
console.log('PASS paid entrance, single-use flag and exit');

const vineTriggers = new Map();
for (const vine of VINES) {
  const id = packId('loc', vine.name);
  assert.deepEqual(vine.placement, [MAP_PLACEMENTS.get(vine.name)[0].x, MAP_PLACEMENTS.get(vine.name)[0].z]);
  for (const option of [1, 3]) {
    vineTriggers.set(`${vine.name}:${option}`, requireTrigger(
      option === 1 ? ServerTriggerType.OPLOC1 : ServerTriggerType.OPLOC3,
      id,
      `[oploc${option},${vine.name}]`
    ));
  }
}
function assertVineRefusal(vine, option, { woodcutting, axe, label }) {
  const player = makePlayer({ tile: vine.start, agility: 1, woodcutting, axe });
  const beforeTile = tileOf(player);
  const beforeWoodcuttingXp = skillXp(player, WOODCUTTING);
  const beforeAgilityXp = skillXp(player, AGILITY);
  const script = vineTriggers.get(`${vine.name}:${option}`);
  NEXT_TICK();
  runToCompletion(player, script, detachedLoc(vine.name, ...vine.placement));
  assert.deepEqual(tileOf(player), beforeTile, `${vine.name} op${option} ${label} does not move`);
  assert.equal(skillXp(player, WOODCUTTING), beforeWoodcuttingXp, `${vine.name} op${option} ${label} awards no Woodcutting XP`);
  assert.equal(skillXp(player, AGILITY), beforeAgilityXp, `${vine.name} op${option} ${label} awards no Agility XP`);
  assert.equal(player.getVar(ACTION_DELAY), 0, `${vine.name} op${option} ${label} stops before the chop delay`);
}
function runVine(vine, option, { from, woodcutting, axe, random, succeeds }) {
  const initial = from === 'start' ? vine.start : vine.end;
  const expected = succeeds ? (from === 'start' ? vine.end : vine.start) : initial;
  const player = makePlayer({ tile: initial, agility: 1, woodcutting, axe });
  const beforeWoodcuttingXp = skillXp(player, WOODCUTTING);
  const beforeAgilityXp = skillXp(player, AGILITY);
  const script = vineTriggers.get(`${vine.name}:${option}`);
  const loc = detachedLoc(vine.name, ...vine.placement);
  withRandom(random, () => {
    const firstTick = NEXT_TICK();
    runToCompletion(player, script, loc);
    const retryTick = player.getVar(ACTION_DELAY);
    assert.equal(retryTick, firstTick + 3, `${vine.name} op${option} schedules its normal three-tick chop`);
    assert.deepEqual(tileOf(player), initial, `${vine.name} op${option} remains on its approach side during the delay`);
    World.currentTick = retryTick;
    runToCompletion(player, script, loc);
  });
  assert.deepEqual(tileOf(player), expected, `${vine.name} op${option} ${from}-side ${succeeds ? 'success' : 'random failure'} landing`);
  assert.equal(skillXp(player, WOODCUTTING), beforeWoodcuttingXp, `${vine.name} op${option} awards no Woodcutting XP`);
  assert.equal(skillXp(player, AGILITY), beforeAgilityXp, `${vine.name} op${option} awards no Agility XP`);
}
for (const vine of VINES) {
  for (const option of [1, 3]) {
    assertVineRefusal(vine, option, { woodcutting: vine.level, axe: false, label: 'without an axe' });
    assertVineRefusal(vine, option, { woodcutting: vine.level - 1, axe: true, label: `below Woodcutting ${vine.level}` });
    runVine(vine, option, { from: 'start', woodcutting: vine.level, axe: true, random: 0, succeeds: true });
    runVine(vine, option, { from: 'start', woodcutting: vine.level, axe: true, random: 0.999999999, succeeds: false });
    runVine(vine, option, { from: 'reverse', woodcutting: 1, axe: false, random: 0, succeeds: true });
  }
}
console.log('PASS all five vines: op1/op3, axe and level gates, success on both sides and deterministic chop failures');

const agilityTriggers = new Map();
for (const obstacle of AGILITY_OBSTACLES) {
  const id = packId('loc', obstacle.name);
  const trigger = requireTrigger(ServerTriggerType.OPLOC1, id, `[oploc1,${obstacle.name}]`);
  agilityTriggers.set(obstacle.name, trigger);
}
function assertAgilityRefusal(obstacle, requirement) {
  const player = makePlayer({ tile: obstacle.start, agility: requirement - 1, woodcutting: 1, hitpoints: 90 });
  const beforeTile = tileOf(player);
  const beforeXp = skillXp(player, AGILITY);
  const script = agilityTriggers.get(obstacle.name);
  NEXT_TICK();
  runToCompletion(player, script, detachedLoc(obstacle.name, ...obstacle.placement));
  assert.deepEqual(tileOf(player), beforeTile, `${obstacle.name} below Agility ${requirement} does not move`);
  assert.equal(skillXp(player, AGILITY), beforeXp, `${obstacle.name} below Agility ${requirement} awards no XP`);
  assert.equal(player.levels[HITPOINTS], 90, `${obstacle.name} below Agility ${requirement} does not damage the player`);
}
function runAgilityAttempt(obstacle, { agility, random, succeeds, label }) {
  const player = makePlayer({ tile: obstacle.start, agility, woodcutting: 1, hitpoints: 90 });
  const beforeXp = skillXp(player, AGILITY);
  withRandom(random, () => {
    NEXT_TICK();
    runToCompletion(player, agilityTriggers.get(obstacle.name), detachedLoc(obstacle.name, ...obstacle.placement));
  });
  if (succeeds) {
    assert.deepEqual(tileOf(player), obstacle.end, `${obstacle.name} ${label} reaches the far side`);
    assert.equal(skillXp(player, AGILITY) - beforeXp, obstacle.xp, `${obstacle.name} ${label} awards exactly ${obstacle.xp} XP tenths`);
    assert.equal(player.levels[HITPOINTS], 90, `${obstacle.name} ${label} does not damage the player`);
  } else {
    assert.deepEqual(tileOf(player), obstacle.fail, `${obstacle.name} ${label} reaches its donor failure tile`);
    assert.equal(skillXp(player, AGILITY), beforeXp, `${obstacle.name} ${label} awards no Agility XP`);
    assert.equal(player.levels[HITPOINTS], 80, `${obstacle.name} ${label} applies current HP / 10 + 1 damage`);
  }
}
const stone1 = AGILITY_OBSTACLES[0];
const stone2 = AGILITY_OBSTACLES[1];
const log1 = AGILITY_OBSTACLES[2];
const log3 = AGILITY_OBSTACLES[3];
assertAgilityRefusal(stone1, 12);
runAgilityAttempt(stone1, { agility: 12, random: 0, succeeds: true, label: 'at Agility 12' });
runAgilityAttempt(stone1, { agility: 12, random: 0.999999999, succeeds: false, label: 'deterministic random failure at Agility 12' });
runAgilityAttempt(stone2, { agility: 1, random: 0, succeeds: true, label: 'reverse-side donor bypass' });
runAgilityAttempt(stone2, { agility: 1, random: 0.999999999, succeeds: false, label: 'reverse-side donor bypass with deterministic random failure' });
assertAgilityRefusal(log1, 22);
runAgilityAttempt(log1, { agility: 22, random: 0, succeeds: true, label: 'at period Agility 22' });
runAgilityAttempt(log1, { agility: 22, random: 0.999999999, succeeds: false, label: 'deterministic random failure at Agility 22' });
runAgilityAttempt(log3, { agility: 1, random: 0, succeeds: true, label: 'reverse-side donor bypass' });
runAgilityAttempt(log3, { agility: 1, random: 0.999999999, succeeds: false, label: 'reverse-side donor bypass with deterministic random failure' });
console.log('PASS stepping stones and logs: forward level gates, both directions, XP, fall damage and random failures');

const pipeTriggers = new Map();
for (const pipe of PIPES) {
  const id = packId('loc', pipe.name);
  pipeTriggers.set(pipe.name, requireTrigger(ServerTriggerType.OPLOC1, id, `[oploc1,${pipe.name}]`));
}
function sharedVarId(name) {
  const id = config.VarSharedType.getId(name);
  assert(Number.isInteger(id) && id >= 0, `generated server variable ${name} resolves by name`);
  assert.equal(config.VarSharedType.get(id).type, ScriptVarType.INT, `${name} is an integer server variable`);
  return id;
}
function assertPipeRefusal(pipe) {
  const player = makePlayer({ tile: pipe.forward.start, agility: pipe.forward.requirement - 1, woodcutting: 1 });
  const beforeTile = tileOf(player);
  const beforeXp = skillXp(player, AGILITY);
  const lock = sharedVarId(pipe.lock);
  World.vars[lock] = 0;
  NEXT_TICK();
  const target = detachedLoc(pipe.name, ...pipe.placement);
  runToCompletion(player, pipeTriggers.get(pipe.name), target);
  assert.deepEqual(tileOf(player), beforeTile, `${pipe.name} below Agility ${pipe.forward.requirement} does not move`);
  assert.equal(skillXp(player, AGILITY), beforeXp, `${pipe.name} below Agility ${pipe.forward.requirement} awards no XP`);
  assert.equal(World.vars[lock], 0, `${pipe.name} level refusal does not acquire its shared lock`);
}
function assertPipeLockAndExpiry(pipe) {
  World.npcs.reset();
  World.gameMap.init();
  const lock = sharedVarId(pipe.lock);
  World.vars[lock] = 0;
  const script = pipeTriggers.get(pipe.name);
  const first = makePlayer({ tile: pipe.forward.start, agility: pipe.forward.requirement, woodcutting: 1 });
  const firstXp = skillXp(first, AGILITY);
  const firstTick = NEXT_TICK();
  const firstLoc = activeLoc(pipe.name, ...pipe.placement);
  const firstRun = startScript(first, script, firstLoc);
  for (let approach = 0; World.vars[lock] === 0; approach++) {
    assert(approach < 10, 'pipe approach reaches its lock before crossing');
    assert.equal(firstRun.state.execution, ScriptState.SUSPENDED);
    World.currentTick = Math.max(World.currentTick, first.delayedUntil);
    first.delayed = false;
    first.executeScript(firstRun.state, true, true);
  }
  const approachTicks = World.currentTick - firstTick;
  assert.equal(firstRun.result, ScriptState.SUSPENDED, `${pipe.name} suspends after it acquires the shared lock`);
  assert.equal(first.activeScript, firstRun.state, `${pipe.name} keeps its first crossing active`);
  const lockUntil = World.vars[lock];
  assert.equal(lockUntil, World.currentTick + 9, `${pipe.name} records the donor nine-tick timestamp`);

  const second = makePlayer({ tile: pipe.forward.start, agility: pipe.forward.requirement, woodcutting: 1 });
  const secondXp = skillXp(second, AGILITY);
  runToCompletion(second, script, firstLoc);
  assert.deepEqual(tileOf(second), pipe.forward.start, `${pipe.name} blocks a second player while the timestamp lock is active`);
  assert.equal(skillXp(second, AGILITY), secondXp, `${pipe.name} lock refusal awards no XP`);
  assert.equal(World.vars[lock], lockUntil, `${pipe.name} preserves the active shared lock`);

  finishDelayed(first);
  assert.deepEqual(tileOf(first), pipe.forward.end, `${pipe.name} first player reaches the other side`);
  assert.equal(skillXp(first, AGILITY) - firstXp, pipe.xp, `${pipe.name} awards exactly ${pipe.xp} XP tenths`);
  assert.equal(World.vars[lock], lockUntil, `${pipe.name} does not explicitly clear the donor timestamp after crossing`);
  if (World.currentTick <= lockUntil) World.currentTick = lockUntil + 1;
  assert(World.currentTick > lockUntil, `${pipe.name} timestamp expires after normal crossing`);

  World.npcs.reset();
  World.gameMap.init();
  const after = makePlayer({ tile: pipe.forward.start, agility: pipe.forward.requirement, woodcutting: 1 });
  const afterXp = skillXp(after, AGILITY);
  const afterTick = World.currentTick;
  runToCompletion(after, script, activeLoc(pipe.name, ...pipe.placement));
  assert.deepEqual(tileOf(after), pipe.forward.end, `${pipe.name} admits a player after the timestamp expires`);
  assert.equal(skillXp(after, AGILITY) - afterXp, pipe.xp, `${pipe.name} expired lock permits its normal XP award`);
  assert.equal(World.vars[lock], afterTick + approachTicks + 9, `${pipe.name} starts a new timestamp after the later crossing`);
}
function assertPipeReverseBypass(pipe) {
  World.npcs.reset();
  World.gameMap.init();
  const lock = sharedVarId(pipe.lock);
  World.vars[lock] = 0;
  const player = makePlayer({ tile: pipe.reverse.start, agility: 1, woodcutting: 1 });
  const beforeXp = skillXp(player, AGILITY);
  NEXT_TICK();
  runToCompletion(player, pipeTriggers.get(pipe.name), activeLoc(pipe.name, ...pipe.placement));
  assert.deepEqual(tileOf(player), pipe.reverse.end, `${pipe.name} reverse-side donor bypass crosses at Agility 1`);
  assert.equal(skillXp(player, AGILITY) - beforeXp, pipe.xp, `${pipe.name} reverse-side crossing awards its normal XP`);
}
for (const pipe of PIPES) {
  assertPipeRefusal(pipe);
  assertPipeLockAndExpiry(pipe);
  assertPipeReverseBypass(pipe);
}
console.log('PASS both pipes: directional requirements, reverse-side crossings, shared locks and natural expiry');
console.log(`RESULT PASS Brimhaven Dungeon packed triggers (${MAP_LOCS.length} loc types, ${walkableTiles.length} collision witnesses)`);
process.exit(0);
