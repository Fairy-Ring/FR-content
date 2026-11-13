import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseOptions(argv = process.argv, defaults = {}) {
  const options = { ...defaults };
  for (let index = 2; index < argv.length; index++) {
    const [name, inlineValue] = argv[index].split(/=(.*)/s, 2);
    if (name !== '--content-root' && name !== '--engine-root') {
      throw new Error(`unknown option: ${argv[index]}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`);
    const key = name === '--content-root' ? 'contentRoot' : 'engineRoot';
    if (options[key]) throw new Error(`${name} was supplied more than once`);
    options[key] = value;
  }
  return options;
}

export function resolveRoots(options = {}) {
  const contentRoot = path.resolve(options.contentRoot ?? path.resolve(HERE, '../..'));
  const engineRoot = path.resolve(options.engineRoot ?? process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine'));
  return { contentRoot, engineRoot, packDir: path.join(engineRoot, 'data/pack') };
}

export function packedId(contentRoot, kind, name) {
  const file = path.join(contentRoot, 'pack', `${kind}.pack`);
  assert(fs.existsSync(file), `missing packed id map ${file}`);
  const row = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(line => line.slice(line.indexOf('=') + 1) === name);
  assert(row, `pack/${kind}.pack is missing ${name}`);
  return Number(row.slice(0, row.indexOf('=')));
}

export function parseEnum(contentRoot, name) {
  const file = path.join(contentRoot, 'scripts/minigames/game_barrows/configs/barrows.enum');
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(new RegExp(`\\[${name}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`));
  assert(match, `missing [${name}] in ${file}`);
  const values = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^val=([^,]+),(.+)$/);
    if (row) values.set(row[1], row[2]);
  }
  return values;
}

export async function loadPackedRuntime(options = {}) {
  const roots = resolveRoots(options);
  const scriptDat = path.join(roots.packDir, 'server/script.dat');
  assert(fs.existsSync(scriptDat), `missing compiled script.dat at ${scriptDat} — build the selected engine pack first`);
  const eng = relative => import(pathToFileURL(path.join(roots.engineRoot, relative)).href);
  const loadDefault = async relative => (await eng(relative)).default;
  const [World, Player, Npc, Loc, ScriptProvider, ScriptRunner, ScriptState, VarPlayerType, VarBitType,
    VarNpcType, LocType, NpcType, EnumType, DbRowType, DbTableType, DbTableIndex, InvType, ObjType, FontType, ParamType, SeqType, Component, JavaRandom,
    { EntityLifeCycle }, { BlockWalk }, { CoordGrid }, { allocateIfAbsent }] = await Promise.all([
    loadDefault('src/engine/World.ts'),
    loadDefault('src/engine/entity/Player.ts'),
    loadDefault('src/engine/entity/Npc.ts'),
    loadDefault('src/engine/entity/Loc.ts'),
    loadDefault('src/engine/script/ScriptProvider.ts'),
    loadDefault('src/engine/script/ScriptRunner.ts'),
    loadDefault('src/engine/script/ScriptState.ts'),
    loadDefault('src/cache/config/VarPlayerType.ts'),
    loadDefault('src/cache/config/VarBitType.ts'),
    loadDefault('src/cache/config/VarNpcType.ts'),
    loadDefault('src/cache/config/LocType.ts'),
    loadDefault('src/cache/config/NpcType.ts'),
    loadDefault('src/cache/config/EnumType.ts'),
    loadDefault('src/cache/config/DbRowType.ts'),
    loadDefault('src/cache/config/DbTableType.ts'),
    loadDefault('src/cache/config/DbTableIndex.ts'),
    loadDefault('src/cache/config/InvType.ts'),
    loadDefault('src/cache/config/ObjType.ts'),
    loadDefault('src/cache/config/FontType.ts'),
    loadDefault('src/cache/config/ParamType.ts'),
    loadDefault('src/cache/config/SeqType.ts'),
    loadDefault('src/cache/config/Component.ts'),
    loadDefault('src/util/JavaRandom.ts'),
    eng('src/engine/entity/EntityLifeCycle.js'),
    eng('src/engine/entity/BlockWalk.js'),
    eng('src/engine/CoordGrid.ts'),
    eng('src/engine/routefinder/index.ts')
  ]);
  for (const config of [VarPlayerType, VarBitType, VarNpcType, LocType, NpcType, EnumType, DbRowType, DbTableType, InvType, ObjType, FontType, ParamType, SeqType, Component]) config.load(roots.packDir);
  DbTableIndex.init();
  assert(FontType.get(3), `FontType q8_full is missing in ${roots.packDir}`);
  assert(ScriptProvider.load(roots.packDir) > 0, `ScriptProvider.load found no compiled scripts in ${roots.packDir}`);
  return { ...roots, World, Player, Npc, Loc, ScriptProvider, ScriptRunner, ScriptState, VarPlayerType,
    VarBitType, VarNpcType, LocType, NpcType, EnumType, InvType, ObjType, FontType, ParamType, SeqType, Component, JavaRandom,
    EntityLifeCycle, BlockWalk, CoordGrid, allocateIfAbsent };
}

export function createRunner(runtime, { prefix = 'barrows_test', firstUid = 8100 } = {}) {
  const { World, Player, Npc, NpcType, VarNpcType, ScriptProvider, ScriptRunner, ScriptState, JavaRandom,
    EntityLifeCycle, BlockWalk } = runtime;
  World.currentTick = 1;
  let nextUid = firstUid;
  const spawnedActors = [];
  function makePlayer(label, level = 0, x = 3552, z = 9696) {
    const player = new Player(`${prefix}_${label}`, 0n, 0n);
    player.uid = nextUid++;
    player.pid = player.uid;
    player.staffModLevel = 0;
    player.level = level;
    player.x = x;
    player.z = z;
    player.messages = [];
    player.packets = [];
    player.lastMovement = 0;
    player.write = message => player.packets.push(message);
    player.messageGame = message => player.messages.push(message);
    player.wrappedMessageGame = message => player.messages.push(message);
    return player;
  }
  function call(player, key, args = [], target = null, protectedAccess = true, force = false) {
    const script = ScriptProvider.getByName(key.startsWith('[') ? key : `[proc,${key}]`);
    assert(script, `compiled script is missing: ${key}`);
    const state = ScriptRunner.init(script, player, target, args);
    const execution = player.runScript(state, protectedAccess, force);
    assert.equal(execution, ScriptState.FINISHED, `${key} must finish synchronously`);
    assert.equal(state.execution, ScriptState.FINISHED, `${key} must not suspend or abort`);
    assert.equal(player.delayed, false, `${key} must not leave a delay`);
    assert.equal(player.activeScript, null, `${key} must not attach a suspended script`);
    assert.equal(player.protect, false, `${key} must release protected access`);
    return state;
  }
  const procVoid = (player, name, args = [], target = null) => {
    const state = call(player, name, args, target);
    assert.equal(state.isp, 0, `${name} must return no ints`);
  };
  const procInt = (player, name, args = [], target = null) => {
    const state = call(player, name, args, target);
    assert.equal(state.isp, 1, `${name} must return one int`);
    return state.popInt();
  };
  function addNpc(typeName, level, ownerUid, x, z, lifecycle = EntityLifeCycle.DESPAWN) {
    const typeId = NpcType.getId(typeName);
    assert.notEqual(typeId, -1, `NPC type missing: ${typeName}`);
    const type = NpcType.get(typeId);
    const npc = new Npc(level, x, z, type.size, type.size, lifecycle, World.getNextNid(), typeId, BlockWalk.NONE);
    World.addNpc(npc, -1);
    // addNpc resets vars; ownership must be assigned only after insertion.
    if (ownerUid !== undefined && ownerUid !== null) {
      const owner = VarNpcType.getId('npc_barrows_owner');
      const generation = VarNpcType.getId('npc_barrows_generation');
      assert.notEqual(owner, -1, 'owned fixture requires npc_barrows_owner');
      assert.notEqual(generation, -1, 'owned fixture requires npc_barrows_generation');
      npc.setVar(owner, ownerUid);
      npc.setVar(generation, 1);
    }
    assert(npc.isActive, `World.addNpc did not activate ${typeName} at L${level}`);
    const row = { npc, nid: npc.nid, typeName, level, ownerUid };
    spawnedActors.push(row);
    return row;
  }
  function removeFixtures(records = spawnedActors) {
    for (const { npc, nid } of records) if (npc.isActive && World.getNpc(nid) === npc) World.removeNpc(npc, -1);
    if (records === spawnedActors) spawnedActors.length = 0;
  }
  function measureRandom(action) {
    const original = JavaRandom.nextDouble;
    let calls = 0;
    JavaRandom.nextDouble = function () { calls++; return original.call(this); };
    try { return { value: action(), calls }; } finally { JavaRandom.nextDouble = original; }
  }
  return { makePlayer, call, procVoid, procInt, addNpc, removeFixtures, spawnedActors, measureRandom };
}

export async function run(main) {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
