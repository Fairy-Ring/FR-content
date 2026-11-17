#!/usr/bin/env node
/**
 * Offline S01 contract through the compiled Barrows procs and real engine objects.
 * Run from the sibling engine after packing:
 *   node --import tsx ../content/tests/barrows/test_core.mjs
 * Pass --content-root and --engine-root to exercise another commit's packs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseOptions(argv) {
  const options = {};
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

const options = parseOptions(process.argv);
const CONTENT_ROOT = path.resolve(options.contentRoot ?? path.resolve(HERE, '../..'));
const ENGINE_ROOT = path.resolve(options.engineRoot ?? process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_ROOT, '../engine'));
const PACK_DIR = path.join(ENGINE_ROOT, 'data/pack');
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');

const REQUIRED_PROCS = [
  'barrows_phase',
  'barrows_tunnel_identity',
  'barrows_inside',
  'barrows_in_tunnels',
  'barrows_run_begin',
  'barrows_layout_choose',
  'barrows_generation_advance',
  'barrows_remove_owned',
  'barrows_search_allowed',
  'barrows_search_latch',
  'barrows_run_reset',
  'barrows_resume',
  'barrows_prayer_remaining',
  'barrows_collapse_remaining',
  'barrows_prayer_set',
  'barrows_collapse_set',
  'barrows_countdown_step'
];

const BROTHER_TYPES = [
  'barrows_ahrim',
  'barrows_dharok',
  'barrows_guthan',
  'barrows_karil',
  'barrows_torag',
  'barrows_verac'
];
const ORDINARY_TYPES = [
  'barrows_rat',
  'barrows_bloodworm',
  'barrows_spider',
  'barrows_giantrat',
  'barrows_skeleton_unarmed',
  'barrows_skeleton_armed',
  'barrows_giantspider'
];
const BARROWS_TYPES = [...BROTHER_TYPES, ...ORDINARY_TYPES];

const STATE = {
  identityMask: 0x00000007,
  phaseMask: 0x00000018,
  cornerMask: 0x00000060,
  entranceMask: 0x00000180,
  solvedMask: 0x00000200,
  familyMask: 0x00000c00,
  permutationMask: 0x00007000,
  challengeMask: 0x00008000,
  assignedMask: 0x0000ffff,
  retainedMask: 0xffff0000 >>> 0,
  phaseShift: 3,
  cornerShift: 5,
  entranceShift: 7,
  familyShift: 10,
  permutationShift: 12
};
const CLIENT_PRESERVED_MASK = (0x3f | (0x7 << 26)) >>> 0;
const MAX_GENERATION = 0x7fffffff;

const u32 = value => value >>> 0;
const field = (value, mask, shift) => (u32(value) & mask) >>> shift;
const packedCoord = (CoordGrid, level, x, z) => CoordGrid.packCoord(level, x, z);

function stateWord({
  high = 0,
  identity = 0,
  phase = 0,
  corner = 0,
  entrance = 0,
  solved = false,
  family = 0,
  permutation = 0,
  challenge = false
} = {}) {
  return u32(
    (u32(high) & STATE.retainedMask) |
    (identity & 0x7) |
    ((phase & 0x3) << STATE.phaseShift) |
    ((corner & 0x3) << STATE.cornerShift) |
    ((entrance & 0x3) << STATE.entranceShift) |
    (solved ? STATE.solvedMask : 0) |
    ((family & 0x3) << STATE.familyShift) |
    ((permutation & 0x7) << STATE.permutationShift) |
    (challenge ? STATE.challengeMask : 0)
  );
}

function parsePackedId(contentRoot, kind, name) {
  const file = path.join(contentRoot, 'pack', `${kind}.pack`);
  assert(fs.existsSync(file), `missing packed id map ${file}`);
  const row = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(line => line.slice(line.indexOf('=') + 1) === name);
  assert(row, `pack/${kind}.pack is missing ${name}`);
  return Number(row.slice(0, row.indexOf('=')));
}

// Compare this pack's real login with and without the Barrows hook. Unrelated
// login changes affect both sides, without a frozen published-state contract.
async function checkInertLogin({ World, Player, ScriptProvider, ScriptRunner, ScriptState, loadDefault, eng }) {
  const types = await Promise.all([
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType',
    'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType',
    'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType'
  ].map(name => loadDefault(`src/cache/config/${name}.ts`)));
  const DbTableIndex = await loadDefault('src/cache/config/DbTableIndex.ts');
  const JavaRandom = await loadDefault('src/util/JavaRandom.ts');
  const { ScriptOpcode } = await eng('src/engine/script/ScriptOpcode.ts');
  const previousCwd = process.cwd();
  process.chdir(ENGINE_ROOT);
  try {

    function loadPack(directory) {
      for (const Type of types) Type.load(directory);
      DbTableIndex.init();
      assert(ScriptProvider.load(directory) > 0, 'login fixture needs a complete compiled pack');
    }

    function observeLogin() {
      const slot = 731;
      assert.equal(World.players[slot] ?? null, null, 'login fixture owns an unused native player slot');
      const player = new Player(`fixture_${slot}`, BigInt(slot), 0n);
      player.slot = slot;
      player.pid = slot;
      player.uid = ((Number(player.username37 & 0x1fffffn) << 11) | slot) >>> 0;
      player.vars.fill(0);
      player.baseLevels.fill(99);
      player.levels.fill(99);
      [player.level, player.x, player.z] = [0, 3222, 3218];
      player.buildArea.originX = Math.floor(player.x / 8) * 8;
      player.buildArea.originZ = Math.floor(player.z / 8) * 8;
      for (const id of [452, 453, 654, 659, 660]) assert.equal(player.getVar(id), 0, 'the account has no Barrows state');
      const messages = [];
      const packets = [];
      player.write = packet => {
        const type = packet.constructor.name;
        if (type === 'MessageGame') messages.push(packet.msg);
        packets.push({ type, ...JSON.parse(JSON.stringify(packet, (_, value) => typeof value === 'bigint' ? String(value) : value)) });
      };
      World.players[slot] = player;
      World.currentTick = 100;
      const random = Math.random;
      const javaRandom = JavaRandom.nextDouble;
      Math.random = () => 0.5;
      JavaRandom.nextDouble = () => 0.5;
      try {
        const script = ScriptProvider.getByName('[login,_]');
        assert(script, 'the selected pack contains the real login root');
        const state = ScriptRunner.init(script, player, null, []);
        player.runScript(state, true);
        for (let resumes = 0; state.execution === ScriptState.SUSPENDED && resumes < 10; resumes++) {
          state.execution = ScriptState.RUNNING;
          player.runScript(state, true, true);
        }
        assert.equal(state.execution, ScriptState.FINISHED, 'the real protected login and its ordinary delays complete');
        return {
          messages,
          varps: [...player.vars],
          packets,
          interfaces: { state: player.modalState, main: player.modalMain, side: player.modalSide, chat: player.modalChat, tutorial: player.modalTutorial, overlay: player.overlay, lastOverlay: player.lastOverlay, tabs: [...player.tabs] },
          coordinates: [player.level, player.x, player.z]
        };
      } finally {
        Math.random = random;
        JavaRandom.nextDouble = javaRandom;
        World.players[slot] = null;
      }
    }

    loadPack(PACK_DIR);
    World.gameMap.init();
    const built = observeLogin();
    const resume = ScriptProvider.getByName('[proc,barrows_resume]');
    assert(resume, 'the built pack contains the actual Barrows login hook');
    assert.equal(resume.intArgCount, 0, 'the replaced hook takes no integer arguments');
    assert.equal(resume.stringArgCount, 0, 'the replaced hook takes no string arguments');
    const fields = ['intLocalCount', 'stringLocalCount', 'intArgCount', 'stringArgCount', 'switchTables', 'opcodes', 'intOperands', 'stringOperands'];
    const saved = Object.fromEntries(fields.map(field => [field, resume[field]]));
    let withoutBarrows;
    try {
      Object.assign(resume, {
        intLocalCount: 0, stringLocalCount: 0, intArgCount: 0, stringArgCount: 0,
        switchTables: [], opcodes: [ScriptOpcode.RETURN], intOperands: [0], stringOperands: ['']
      });
      withoutBarrows = observeLogin();
    } finally {
      Object.assign(resume, saved);
    }
    assert.deepEqual(built, withoutBarrows, 'the Barrows login hook must be observationally inert for a no-Barrows account');
    console.log('OK same-pack no-Barrows login: all varps, packets, messages, interfaces, tabs and coordinates match the return-only hook');
    if (process.env.BARROWS_PUBLISHED_LOGIN_PACK) {
      try {
        loadPack(path.resolve(process.env.BARROWS_PUBLISHED_LOGIN_PACK));
        assert.deepEqual(observeLogin(), built, 'the independently built published and head logins have identical observables in this run');
        console.log('OK optional independent published-pack login comparison');
      } finally {
        loadPack(PACK_DIR);
      }
    }
  } finally {
    process.chdir(previousCwd);
  }
}

async function main() {
  assert(fs.existsSync(SCRIPT_DAT), `missing compiled script.dat at ${SCRIPT_DAT} — build the selected engine pack first`);
  const eng = relative => import(pathToFileURL(path.join(ENGINE_ROOT, relative)).href);
  const loadDefault = async relative => (await eng(relative)).default;

  const World = await loadDefault('src/engine/World.ts');
  const Player = await loadDefault('src/engine/entity/Player.ts');
  const Npc = await loadDefault('src/engine/entity/Npc.ts');
  const ScriptProvider = await loadDefault('src/engine/script/ScriptProvider.ts');
  const ScriptRunner = await loadDefault('src/engine/script/ScriptRunner.ts');
  const ScriptState = await loadDefault('src/engine/script/ScriptState.ts');
  const VarPlayerType = await loadDefault('src/cache/config/VarPlayerType.ts');
  const VarBitType = await loadDefault('src/cache/config/VarBitType.ts');
  const VarNpcType = await loadDefault('src/cache/config/VarNpcType.ts');
  const NpcType = await loadDefault('src/cache/config/NpcType.ts');
  const EnumType = await loadDefault('src/cache/config/EnumType.ts');
  const InvType = await loadDefault('src/cache/config/InvType.ts');
  const ObjType = await loadDefault('src/cache/config/ObjType.ts');
  const FontType = await loadDefault('src/cache/config/FontType.ts');
  const Component = await loadDefault('src/cache/config/Component.ts');
  const JavaRandom = await loadDefault('src/util/JavaRandom.ts');
  const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.js');
  const { BlockWalk } = await eng('src/engine/entity/BlockWalk.js');
  const { CoordGrid } = await eng('src/engine/CoordGrid.ts');

  for (const config of [VarPlayerType, VarBitType, VarNpcType, NpcType, EnumType, InvType, ObjType, FontType, Component]) {
    config.load(PACK_DIR);
  }
  assert(FontType.get(3), `FontType q8_full is missing in ${PACK_DIR}`);
  assert(ScriptProvider.load(PACK_DIR) > 0, `ScriptProvider.load found no compiled scripts in ${PACK_DIR}`);

  // Resolve every S01 entry point before reading new config names: the published
  // pre-S01 pack must fail specifically for the missing product API.
  for (const name of REQUIRED_PROCS) {
    assert(ScriptProvider.getByName(`[proc,${name}]`), `compiled S01 proc is missing: [proc,${name}]`);
  }

  const ids = {
    clientState: parsePackedId(CONTENT_ROOT, 'varp', 'barrows'),
    credit: parsePackedId(CONTENT_ROOT, 'varp', 'barrows_kills'),
    state: parsePackedId(CONTENT_ROOT, 'varp', 'barrows_state'),
    generation: parsePackedId(CONTENT_ROOT, 'varp', 'barrows_generation'),
    countdowns: parsePackedId(CONTENT_ROOT, 'varp', 'barrows_countdowns'),
    actorOwner: parsePackedId(CONTENT_ROOT, 'varn', 'npc_barrows_owner'),
    actorGeneration: parsePackedId(CONTENT_ROOT, 'varn', 'npc_barrows_generation'),
    npcTypes: Object.fromEntries(BARROWS_TYPES.map(name => [name, parsePackedId(CONTENT_ROOT, 'npc', name)]))
  };
  assert.deepEqual(
    [ids.clientState, ids.credit, ids.state, ids.generation, ids.countdowns],
    [452, 453, 654, 659, 660],
    'S01 must consume the original Barrows vars and only its three assigned unused vars'
  );
  for (const [name, id] of [
    ['barrows', ids.clientState],
    ['barrows_kills', ids.credit],
    ['barrows_state', ids.state],
    ['barrows_generation', ids.generation],
    ['barrows_countdowns', ids.countdowns]
  ]) {
    assert.equal(VarPlayerType.getId(name), id, `packed varp identity for ${name}`);
    assert(VarPlayerType.get(id), `packed varp config missing ${name}`);
  }
  for (const [name, id] of [['npc_barrows_owner', ids.actorOwner], ['npc_barrows_generation', ids.actorGeneration]]) {
    assert.equal(VarNpcType.getId(name), id);
    assert(VarNpcType.get(id), `${name} config is missing`);
  }
  for (const [name, id] of Object.entries(ids.npcTypes)) {
    assert.equal(NpcType.getId(name), id, `packed NPC identity for ${name}`);
    assert(NpcType.get(id), `packed NPC config missing ${name}`);
  }

  World.currentTick = 1;
  let nextPlayerUid = 4100;
  const spawnedActors = [];
  let nextPosition = 0;

  function makePlayer(label, level = 0, x = 3552, z = 9696) {
    const player = new Player(`barrows_s01_${label}`, 0n, 0n);
    player.uid = nextPlayerUid++;
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

  function setVars(player, { clientState, credit, state, generation, countdowns }) {
    if (clientState !== undefined) player.setVar(ids.clientState, clientState);
    if (credit !== undefined) player.setVar(ids.credit, credit);
    if (state !== undefined) player.setVar(ids.state, state);
    if (generation !== undefined) player.setVar(ids.generation, generation);
    if (countdowns !== undefined) player.setVar(ids.countdowns, countdowns);
  }

  function snapshot(player) {
    return {
      clientState: u32(player.getVar(ids.clientState)),
      credit: u32(player.getVar(ids.credit)),
      state: u32(player.getVar(ids.state)),
      generation: u32(player.getVar(ids.generation)),
      countdowns: u32(player.getVar(ids.countdowns))
    };
  }

  function callProc(player, name, args = [], { target = null, protectedAccess = true, force = false } = {}) {
    const script = ScriptProvider.getByName(`[proc,${name}]`);
    assert(script, `compiled S01 proc is missing: [proc,${name}]`);
    const state = ScriptRunner.init(script, player, target, args);
    const execution = player.runScript(state, protectedAccess, force);
    return { state, execution };
  }

  function assertFinished(player, result, label) {
    assert.equal(result.execution, ScriptState.FINISHED, `${label} must finish synchronously`);
    assert.equal(result.state.execution, ScriptState.FINISHED, `${label} must not suspend or abort`);
    assert.equal(player.delayed, false, `${label} must not leave a delay`);
    assert.equal(player.activeScript, null, `${label} must not attach a suspended player script`);
    assert.equal(player.protect, false, `${label} must release protected access`);
  }

  function procInt(player, name, args = [], options = {}) {
    const result = callProc(player, name, args, options);
    assertFinished(player, result, name);
    assert.equal(result.state.isp, 1, `${name} must return exactly one int`);
    return result.state.popInt();
  }

  function procVoid(player, name, args = [], options = {}) {
    const result = callProc(player, name, args, options);
    assertFinished(player, result, name);
    assert.equal(result.state.isp, 0, `${name} must not return a value`);
  }

  function procPair(player, name, args = [], options = {}) {
    const result = callProc(player, name, args, options);
    assertFinished(player, result, name);
    assert.equal(result.state.isp, 2, `${name} must return two ints`);
    return result.state.popInts(2);
  }

  function measureRandom(action) {
    const original = JavaRandom.nextDouble;
    let calls = 0;
    JavaRandom.nextDouble = function () {
      calls++;
      return original.call(this);
    };
    try {
      return { value: action(), calls };
    } finally {
      JavaRandom.nextDouble = original;
    }
  }

  function addActor(typeName, level, ownerUid, x, z, lifecycle = EntityLifeCycle.DESPAWN) {
    const typeId = ids.npcTypes[typeName];
    const type = NpcType.get(typeId);
    const npc = new Npc(level, x, z, type.size, type.size, lifecycle, World.getNextNid(), typeId, BlockWalk.NONE);
    World.addNpc(npc, -1);
    npc.setVar(ids.actorOwner, ownerUid);
    npc.setVar(ids.actorGeneration, ownerUid > 0 ? 1 : 0);
    assert(npc.isActive, `World.addNpc did not activate ${typeName} at L${level}`);
    const record = { npc, nid: npc.nid, typeName, level, ownerUid, lifetime:npc.lifecycleTick };
    spawnedActors.push(record);
    return record;
  }

  function removeFixtures(records = spawnedActors) {
    for (const { npc, nid } of records) {
      if (npc.isActive && World.getNpc(nid) === npc) World.removeNpc(npc, -1);
    }
    if (records === spawnedActors) spawnedActors.length = 0;
  }

  function assertDeleted(records, label) {
    for (const { npc, nid, typeName, level, lifetime } of records) {
      if (['barrows_rat', 'barrows_bloodworm', 'barrows_skeleton_unarmed'].includes(typeName)) {
        assert.deepEqual([World.getNpc(nid), npc.isActive, npc.isActive && npc.getVar(VarNpcType.getId('npc_barrows_released')), npc.lifecycleTick],
          [npc, true, 1, lifetime], `${label} releases ${typeName} on L${level} publicly for its original lifetime`);
        continue;
      }
      assert.notEqual(World.getNpc(nid), npc, `${label} left ${typeName} active on L${level}`);
      assert.equal(npc.isActive, false, `${label} did not deactivate ${typeName} on L${level}`);
    }
  }

  function assertRetained(records, label) {
    for (const { npc, nid, typeName, level } of records) {
      assert.equal(World.getNpc(nid), npc, `${label} removed ${typeName} on L${level}`);
      assert.equal(npc.isActive, true, `${label} deactivated ${typeName} on L${level}`);
    }
  }

  function observeWorldDeletions(player, watchedNids, action) {
    const original = World.removeNpc;
    const observations = [];
    World.removeNpc = function (npc, duration) {
      if (watchedNids.has(npc.nid)) {
        observations.push({
          nid: npc.nid,
          generation: u32(player.getVar(ids.generation)),
          state: u32(player.getVar(ids.state)),
          credit: u32(player.getVar(ids.credit)),
          countdowns: u32(player.getVar(ids.countdowns))
        });
      }
      return original.call(this, npc, duration);
    };
    try {
      return { value: action(), observations };
    } finally {
      World.removeNpc = original;
    }
  }

  function assertDeleteOrder(observations, records, expected, label) {
    records = records.filter(row => !['barrows_rat', 'barrows_bloodworm', 'barrows_skeleton_unarmed'].includes(row.typeName));
    assert.equal(observations.length, records.length, `${label} must delete every watched owner actor through World.removeNpc`);
    assert.deepEqual(
      [...observations.map(row => row.nid)].sort((left, right) => left - right),
      records.map(row => row.nid).sort((left, right) => left - right),
      `${label} must delete exactly the watched actors`
    );
    for (const row of observations) {
      assert.equal(row.generation, u32(expected.generation), `${label} generation at World.removeNpc`);
      assert.equal(row.state, u32(expected.state), `${label} cleared/changed run state before World.removeNpc`);
      assert.equal(row.credit, u32(expected.credit), `${label} cleared credit before World.removeNpc`);
      assert.equal(row.countdowns, u32(expected.countdowns), `${label} cleared countdowns before World.removeNpc`);
    }
  }

  function assertLayout(player, sourceClient, label) {
    const actual = u32(player.getVar(ids.clientState));
    const state = u32(player.getVar(ids.state));
    assert.equal(actual & CLIENT_PRESERVED_MASK, sourceClient & CLIENT_PRESERVED_MASK, `${label} preserves unrelated original client fields`);
    assert.equal((actual >>> 6) & 15, 1 << ((state >>> 5) & 3), `${label} shows exactly its selected ladder`);
    assert.equal(actual >>> 29, 0, `${label} clears puzzle presentation`);
    const locks = (actual >>> 10) & 0xffff;
    const central = [4, 8, 9, 11];
    for (const [entrance, bit] of central.entries()) assert.equal((locks >>> bit) & 1, entrance === ((state >>> 7) & 3) ? 0 : 1, `${label} central edge ${entrance}`);
    for (const [first, second] of [[3, 5], [2, 10], [6, 12], [13, 14]]) assert.notEqual(((locks >>> first) & 1) + ((locks >>> second) & 1), 2, `${label} side room retains a corner route`);
  }

  function stateHigh(raw) {
    return u32(raw) & STATE.retainedMask;
  }

  function assertProtectedDenied(player, name, args = [], target = null) {
    const before = snapshot(player);
    const packetCount = player.packets.length;
    player.protect = true;
    const result = callProc(player, name, args, { target });
    assert.equal(result.execution, -1, `${name} must reject an already-protected player`);
    assert.deepEqual(snapshot(player), before, `${name} changed durable state without protected access`);
    assert.equal(player.packets.length, packetCount, `${name} emitted output without protected access`);
    player.protect = false;
  }

  try {
    const player = makePlayer('begin');
    const beginSeedState = stateWord({ high: 0xbeef0000, identity: 7, phase: 0, corner: 3, entrance: 2, solved: true, family: 3, permutation: 7, challenge: true });
    const beginSeedClient = 0xa5a5a5a5;
    const beginSeedCredit = 0xf2345678;
    const beginSeedCountdowns = 0x87654321;
    setVars(player, {
      clientState: beginSeedClient,
      credit: beginSeedCredit,
      state: beginSeedState,
      generation: 41,
      countdowns: beginSeedCountdowns
    });
    const beginActors = [
      addActor('barrows_ahrim', 0, player.uid, 3548, 9695),
      addActor('barrows_rat', 0, player.uid, 3550, 9698)
    ];
    const beginDeletion = observeWorldDeletions(player, new Set(beginActors.map(row => row.nid)), () =>
      measureRandom(() => procInt(player, 'barrows_run_begin'))
    );
    assert.equal(beginDeletion.value.value, 1, 'idle run_begin must return true');
    assert.equal(beginDeletion.value.calls, 2, 'idle run_begin draws identity and one global layout seam');
    assertDeleteOrder(beginDeletion.observations, beginActors, {
      generation: 42,
      state: beginSeedState,
      credit: beginSeedCredit,
      countdowns: beginSeedCountdowns
    }, 'run_begin');
    assertDeleted(beginActors, 'run_begin');
    const firstIdentity = procInt(player, 'barrows_tunnel_identity');
    assert(firstIdentity >= 1 && firstIdentity <= 6, `run_begin chose invalid tunnel identity ${firstIdentity}`);
    assert.equal(procInt(player, 'barrows_phase'), 1, 'run_begin must enter unlooted phase');
    assert.equal(u32(player.getVar(ids.generation)), 42, 'run_begin must advance the generation');
    assert.equal(u32(player.getVar(ids.credit)), 0, 'run_begin must clear all 453 credit and counters');
    assert.equal(u32(player.getVar(ids.countdowns)), 0, 'run_begin must clear both saved countdowns');
    const beginState = u32(player.getVar(ids.state));
    assert.equal(u32(beginState & ~(STATE.cornerMask | STATE.entranceMask)), u32(stateHigh(beginSeedState) | firstIdentity | (1 << STATE.phaseShift)), 'run_begin rewrites assigned fields and preserves bits 16..31');
    assert.equal(field(beginState, STATE.identityMask, 0), firstIdentity);
    assert.equal(field(beginState, STATE.phaseMask, STATE.phaseShift), 1);
    assert.equal(beginState & (STATE.solvedMask | STATE.familyMask | STATE.permutationMask | STATE.challengeMask), 0, 'run_begin clears solved, puzzle and active-challenge fields');
    assertLayout(player, beginSeedClient, 'run_begin');
    assert.notEqual(field(beginState, STATE.cornerMask, STATE.cornerShift), 3, 'run_begin excludes the previous ladder corner from its nonzero-generation state');
    assert.notEqual(field(beginState, STATE.entranceMask, STATE.entranceShift), 2, 'run_begin excludes the previous central entrance from its nonzero-generation state');

    // An unlooted run is idempotent: no state writes, actor cleanup, or RNG.
    const idempotentSeedState = stateWord({ high: 0xa55a0000, identity: 4, phase: 1, corner: 2, entrance: 3, solved: true, family: 2, permutation: 6, challenge: true });
    setVars(player, {
      clientState: 0x5aa53cc3,
      credit: 0xfedcba98,
      state: idempotentSeedState,
      generation: 91,
      countdowns: 0x80001234
    });
    const idempotentActor = addActor('barrows_bloodworm', 0, player.uid, 3551, 9697);
    const idempotentBefore = snapshot(player);
    const idempotentPackets = player.packets.length;
    const idempotent = measureRandom(() => procInt(player, 'barrows_run_begin'));
    assert.equal(idempotent.value, 1, 'phase-1 run_begin must return true');
    assert.equal(idempotent.calls, 0, 'phase-1 run_begin must not draw randomness');
    assert.deepEqual(snapshot(player), idempotentBefore, 'phase-1 run_begin must not write any durable Barrows varp');
    assert.equal(player.packets.length, idempotentPackets, 'phase-1 run_begin must not transmit a client-state write');
    assertRetained([idempotentActor], 'phase-1 run_begin');

    for (const phase of [2, 3]) {
      const phaseState = stateWord({ high: 0xcafe0000, identity: 6, phase, corner: 1, entrance: 2, solved: true, family: 3, permutation: 5, challenge: true });
      setVars(player, {
        clientState: 0x5aa53cc3,
        credit: 0x76543210,
        state: phaseState,
        generation: 117 + phase,
        countdowns: 0x91234567
      });
      const phaseActor = addActor('barrows_spider', 3, player.uid, 3553, 9699);
      const before = snapshot(player);
      const packets = player.packets.length;
      const refused = measureRandom(() => procInt(player, 'barrows_run_begin'));
      assert.equal(refused.value, 0, `phase-${phase} run_begin must return false`);
      assert.equal(refused.calls, 0, `phase-${phase} run_begin must not draw randomness`);
      assert.deepEqual(snapshot(player), before, `phase-${phase} run_begin must not change durable state`);
      assert.equal(player.packets.length, packets, `phase-${phase} run_begin must not send packets`);
      assertRetained([phaseActor], `phase-${phase} run_begin`);
      removeFixtures([phaseActor]);
    }
    removeFixtures([idempotentActor]);

    // The public coordinate helpers distinguish both Barrows levels from the
    // level-0-only tunnels, and reject adjacent map squares and other levels.
    const coordinatePlayer = makePlayer('coordinates');
    const coordinateCases = [
      { coord: packedCoord(CoordGrid, 0, 3552, 9696), inside: true, tunnels: true, label: 'level-0 center' },
      { coord: packedCoord(CoordGrid, 0, 3520, 9664), inside: true, tunnels: true, label: 'level-0 southwest boundary' },
      { coord: packedCoord(CoordGrid, 0, 3583, 9727), inside: true, tunnels: true, label: 'level-0 northeast boundary' },
      { coord: packedCoord(CoordGrid, 3, 3552, 9696), inside: true, tunnels: false, label: 'level-3 crypt' },
      { coord: packedCoord(CoordGrid, 1, 3552, 9696), inside: false, tunnels: false, label: 'other level' },
      { coord: packedCoord(CoordGrid, 0, 3584, 9696), inside: false, tunnels: false, label: 'east adjacent map square' },
      { coord: packedCoord(CoordGrid, 3, 3552, 9728), inside: false, tunnels: false, label: 'north adjacent map square' }
    ];
    for (const row of coordinateCases) {
      assert.equal(procInt(coordinatePlayer, 'barrows_inside', [row.coord]), Number(row.inside), `barrows_inside: ${row.label}`);
      assert.equal(procInt(coordinatePlayer, 'barrows_in_tunnels', [row.coord]), Number(row.tunnels), `barrows_in_tunnels: ${row.label}`);
    }

    // Search authorization requires phase 1, the exact generation, an identity
    // in 1..6, and the player's current coordinate in the level-0 tunnels.
    const searchPlayer = makePlayer('search');
    const searchGeneration = 212;
    const searchState = stateWord({ high: 0x5a5a0000, identity: 5, phase: 1, corner: 2, entrance: 3, solved: true, family: 3, permutation: 6, challenge: true });
    const searchSeed = {
      clientState: 0x9a5ac33c,
      credit: 0xfedc9876,
      state: searchState,
      generation: searchGeneration,
      countdowns: 0xd00dbeef
    };
    setVars(searchPlayer, searchSeed);
    const allowedBefore = snapshot(searchPlayer);
    const allowed = measureRandom(() => procInt(searchPlayer, 'barrows_search_allowed', [searchGeneration]));
    assert.equal(allowed.value, 1, 'matching unlooted generation at a valid tunnel coordinate must allow Search');
    assert.equal(allowed.calls, 0, 'search_allowed must not draw randomness');
    assert.deepEqual(snapshot(searchPlayer), allowedBefore, 'search_allowed must be a read-only guard');

    const rejectedSearchCases = [
      { label: 'stale generation', phase: 1, identity: 5, level: 0, x: 3552, z: 9696, storedGeneration: searchGeneration, argumentGeneration: searchGeneration - 1 },
      { label: 'idle phase', phase: 0, identity: 5, level: 0, x: 3552, z: 9696 },
      { label: 'paid phase', phase: 2, identity: 5, level: 0, x: 3552, z: 9696 },
      { label: 'invalid phase', phase: 3, identity: 5, level: 0, x: 3552, z: 9696 },
      { label: 'unset identity', phase: 1, identity: 0, level: 0, x: 3552, z: 9696 },
      { label: 'identity above six', phase: 1, identity: 7, level: 0, x: 3552, z: 9696 },
      { label: 'crypt level', phase: 1, identity: 5, level: 3, x: 3552, z: 9696 },
      { label: 'outside tunnel region', phase: 1, identity: 5, level: 0, x: 3584, z: 9696 }
    ];
    for (const [index, row] of rejectedSearchCases.entries()) {
      searchPlayer.level = row.level;
      searchPlayer.x = row.x;
      searchPlayer.z = row.z;
      const generation = row.storedGeneration ?? searchGeneration;
      const argumentGeneration = row.argumentGeneration ?? generation;
      setVars(searchPlayer, {
        clientState: 0x6132a59c,
        credit: 0x8badf00d,
        state: stateWord({ high: 0x3c3c0000, identity: row.identity, phase: row.phase, corner: index & 3, entrance: (index + 1) & 3, solved: true, family: 2, permutation: 4, challenge: true }),
        generation,
        countdowns: 0x7654fedc
      });
      const before = snapshot(searchPlayer);
      const allowedResult = measureRandom(() => procInt(searchPlayer, 'barrows_search_allowed', [argumentGeneration]));
      assert.equal(allowedResult.value, 0, `search_allowed must reject ${row.label}`);
      assert.equal(allowedResult.calls, 0, `search_allowed(${row.label}) must not draw randomness`);
      assert.deepEqual(snapshot(searchPlayer), before, `search_allowed(${row.label}) must not write state`);
      const latchResult = measureRandom(() => procInt(searchPlayer, 'barrows_search_latch', [argumentGeneration]));
      assert.equal(latchResult.value, 0, `search_latch must reject ${row.label}`);
      assert.equal(latchResult.calls, 0, `search_latch(${row.label}) must not draw randomness`);
      assert.deepEqual(snapshot(searchPlayer), before, `search_latch(${row.label}) must be atomic on rejection`);
    }

    searchPlayer.level = 0;
    searchPlayer.x = 3552;
    searchPlayer.z = 9696;
    setVars(searchPlayer, searchSeed);
    const searchCornerBefore = field(searchSeed.state, STATE.cornerMask, STATE.cornerShift);
    const searchEntranceBefore = field(searchSeed.state, STATE.entranceMask, STATE.entranceShift);
    const searchLocksBefore = (u32(searchSeed.clientState) >>> 10) & 0xffff;
    const latchActors = [
      addActor('barrows_guthan', 0, searchPlayer.uid, 3549, 9694),
      addActor('barrows_skeleton_armed', 3, searchPlayer.uid, 3550, 9700)
    ];
    const latchStateAfter = stateWord({ high: 0x5a5a0000, identity: 5, phase: 2, corner: 2, entrance: 3 });
    const latchDeletion = observeWorldDeletions(searchPlayer, new Set(latchActors.map(row => row.nid)), () =>
      measureRandom(() => procInt(searchPlayer, 'barrows_search_latch', [searchGeneration]))
    );
    assert.equal(latchDeletion.value.value, 1, 'valid Search latch must return true');
    assert.equal(latchDeletion.value.calls, 0, 'Search performs no random layout, corner or entrance draw');
    assertDeleteOrder(latchDeletion.observations, latchActors, {
      generation: searchGeneration + 1,
      state: latchStateAfter,
      credit: searchSeed.credit,
      countdowns: searchSeed.countdowns
    }, 'search_latch');
    assertDeleted(latchActors, 'search_latch');
    assert.equal(u32(searchPlayer.getVar(ids.state)), latchStateAfter, 'Search retains identity, phase, selectors and upper state and clears puzzle authorization before cleanup');
    assert.equal(procInt(searchPlayer, 'barrows_phase'), 2, 'Search must freeze the run in paid phase');
    assert.equal(procInt(searchPlayer, 'barrows_tunnel_identity'), 5, 'Search must retain the selected tunnel identity');
    assert.equal(u32(searchPlayer.getVar(ids.generation)), searchGeneration + 1, 'Search must advance generation after latching');
    assert.equal(field(searchPlayer.getVar(ids.state), STATE.cornerMask, STATE.cornerShift), searchCornerBefore, 'Search preserves the selected ladder corner');
    assert.equal(field(searchPlayer.getVar(ids.state), STATE.entranceMask, STATE.entranceShift), searchEntranceBefore, 'Search preserves the selected central entrance');
    assert.equal(((u32(searchPlayer.getVar(ids.clientState)) >>> 10) & 0xffff), searchLocksBefore, 'Search preserves the current personal lock layout');
    assert.equal(u32(searchPlayer.getVar(ids.credit)), searchSeed.credit, 'Search must freeze and retain all 453 credit bits');
    const collapseInterval = fs.readFileSync(path.join(CONTENT_ROOT, 'scripts/minigames/game_barrows/configs/barrows.constant'), 'utf8')
      .match(/^\^barrows_collapse_interval_ticks\s*=\s*(\d+)\s*$/m);
    assert(collapseInterval, 'S13 declares its named collapse interval');
    assert.equal(u32(searchPlayer.getVar(ids.countdowns)), u32((Number(collapseInterval[1]) << 16) | (searchSeed.countdowns & 0xffff)), 'Search arms the named collapse interval and preserves Prayer');
    assert.equal(procInt(searchPlayer, 'barrows_search_allowed', [searchGeneration + 1]), 0, 'paid phase must reject Search authorization');

    // Owner cleanup covers every authored actor type on both levels. Only the
    // current player's owned actors disappear; B, ownerless/static-like, and
    // the primary NPC pointer survive. Observe real World.removeNpc calls to
    // assert cleanup precedes generation reuse at integer wrap.
    const ownerA = makePlayer('cleanup_a');
    const ownerB = makePlayer('cleanup_b');
    const wrapSeedState = stateWord({ high: 0x77770000, identity: 3, phase: 1, corner: 2, entrance: 1, solved: true, family: 1, permutation: 3, challenge: true });
    const wrapSeedCredit = 0xdecafbad;
    const wrapSeedCountdowns = 0x8000abcd;
    setVars(ownerA, {
      clientState: 0x9876fedc,
      credit: wrapSeedCredit,
      state: wrapSeedState,
      generation: MAX_GENERATION,
      countdowns: wrapSeedCountdowns
    });
    const ownedActors = [];
    for (let index = 0; index < BARROWS_TYPES.length; index++) {
      const name = BARROWS_TYPES[index];
      const x = 3544 + (index % 5) * 2;
      const z = 9691 + Math.floor(index / 5) * 2;
      ownedActors.push(addActor(name, 0, ownerA.uid, x, z));
      if (!['barrows_rat', 'barrows_bloodworm', 'barrows_skeleton_unarmed'].includes(name)) {
        ownedActors.push(addActor(name, 3, ownerA.uid, x, z + 8));
      }
    }
    const playerBActors = [
      addActor('barrows_ahrim', 0, ownerB.uid, 3557, 9697),
      addActor('barrows_bloodworm', 3, ownerB.uid, 3558, 9700)
    ];
    const unownedActors = [
      addActor('barrows_rat', 0, 0, 3558, 9699, EntityLifeCycle.RESPAWN),
      addActor('barrows_skeleton_unarmed', 3, 0, 3559, 9701, EntityLifeCycle.RESPAWN)
    ];
    const primaryNpc = addActor('barrows_karil', 0, ownerB.uid, 3560, 9702, EntityLifeCycle.RESPAWN);
    const expectedWrapRemoval = snapshot(ownerA);
    const wrapDeletion = observeWorldDeletions(ownerA, new Set(ownedActors.map(row => row.nid)), () =>
      measureRandom(() => procVoid(ownerA, 'barrows_generation_advance', [], { target: primaryNpc.npc }))
    );
    assert.equal(wrapDeletion.value.calls, 0, 'generation advancement must not draw randomness');
    assertDeleteOrder(wrapDeletion.observations, ownedActors, expectedWrapRemoval, 'generation wrap');
    assertDeleted(ownedActors, 'generation wrap');
    assertRetained(playerBActors, 'generation wrap for player A');
    assertRetained(unownedActors, 'generation wrap for unowned/static-like actors');
    assertRetained([primaryNpc], 'generation wrap with a primary NPC pointer');
    assert.equal(u32(ownerA.getVar(ids.generation)), 1, '2147483647 must wrap to generation 1');
    assert.equal(u32(ownerA.getVar(ids.state)), wrapSeedState, 'generation advancement must not alter run state');
    assert.equal(u32(ownerA.getVar(ids.credit)), wrapSeedCredit, 'generation advancement must not alter frozen or live credit');
    assert.equal(u32(ownerA.getVar(ids.countdowns)), wrapSeedCountdowns, 'generation advancement must not alter saved countdowns');
    removeFixtures();

    const zeroGenerationPlayer = makePlayer('zero_generation');
    const zeroGenerationState = stateWord({ high: 0xface0000, identity: 2, phase: 1 });
    setVars(zeroGenerationPlayer, { state: zeroGenerationState, generation: 0, credit: 0x12345678, countdowns: 0x80000001 });
    procVoid(zeroGenerationPlayer, 'barrows_generation_advance');
    assert.equal(u32(zeroGenerationPlayer.getVar(ids.generation)), 1, 'generation 0 must advance to 1, never remain zero');
    assert.equal(u32(zeroGenerationPlayer.getVar(ids.state)), zeroGenerationState, 'generation advance from zero must preserve state');
    assert.equal(u32(zeroGenerationPlayer.getVar(ids.credit)), 0x12345678, 'generation advance from zero must preserve credit');
    assert.equal(u32(zeroGenerationPlayer.getVar(ids.countdowns)), 0x80000001, 'generation advance from zero must preserve countdowns');

    // Reset is reserved for a paid run. Every other phase is a strict no-op,
    // including owned actors and the current UI presentation.
    const resetGuardModal = Component.getId('inter_234');
    const resetGuardOverlay = Component.getId('kill_count');
    assert.notEqual(resetGuardModal, -1, 'runtime component config contains the guard modal');
    assert.notEqual(resetGuardOverlay, -1, 'runtime component config contains kill_count');
    for (const [index, phase] of [0, 1, 3].entries()) {
      const guardedPlayer = makePlayer(`reset_guard_phase_${phase}`);
      const guardedSeed = {
        clientState: 0x5a5a1234 + index,
        credit: 0x76543210 + index,
        state: stateWord({
          high: 0x71000000 | (index << 16), identity: index + 1, phase,
          corner: index + 1, entrance: index + 2, solved: true,
          family: 2, permutation: 6, challenge: true
        }),
        generation: 151 + index,
        countdowns: 0x80004321 + index
      };
      setVars(guardedPlayer, guardedSeed);
      const guardedOwned = addActor('barrows_giantrat', 3, guardedPlayer.uid, 3551, 9696);
      const guardedForeign = addActor('barrows_ahrim', 3, guardedPlayer.uid + 1_000_000, 3553, 9698);
      guardedPlayer.openMainModal(resetGuardModal);
      guardedPlayer.openMainOverlay(resetGuardOverlay);
      guardedPlayer.packets.length = 0;
      const before = snapshot(guardedPlayer);
      const modalBefore = guardedPlayer.modalMain;
      const overlayBefore = guardedPlayer.overlay;
      const pendingCloseBefore = guardedPlayer.pendingModalClose;
      const packetCountBefore = guardedPlayer.packets.length;
      const messageCountBefore = guardedPlayer.messages.length;
      const guardedReset = measureRandom(() => procVoid(guardedPlayer, 'barrows_run_reset'));
      assert.equal(guardedReset.calls, 0, `phase-${phase} reset guard must not draw randomness`);
      assert.deepEqual(snapshot(guardedPlayer), before, `phase-${phase} reset guard preserves every durable field`);
      assertRetained([guardedOwned, guardedForeign], `phase-${phase} reset guard`);
      assert.equal(guardedPlayer.modalMain, modalBefore, `phase-${phase} reset guard preserves modal presentation`);
      assert.equal(guardedPlayer.overlay, overlayBefore, `phase-${phase} reset guard preserves overlay presentation`);
      assert.equal(guardedPlayer.pendingModalClose, pendingCloseBefore, `phase-${phase} reset guard preserves pending modal state`);
      assert.equal(guardedPlayer.packets.length, packetCountBefore, `phase-${phase} reset guard emits no presentation packets`);
      assert.equal(guardedPlayer.messages.length, messageCountBefore, `phase-${phase} reset guard emits no messages`);
      assert.equal(procInt(guardedPlayer, 'barrows_phase'), phase, `phase-${phase} reset guard preserves phase`);
      removeFixtures([guardedOwned, guardedForeign]);
    }

    // A blocked protected call cannot partially reset; the paid reset then
    // deletes actors before clearing state/credit/countdowns and returns idle.
    const resetPlayer = makePlayer('reset');
    const resetSeedState = stateWord({ high: 0x6b6b0000, identity: 6, phase: 2, corner: 1, entrance: 3, solved: true, family: 2, permutation: 5, challenge: true });
    assert.equal(field(resetSeedState, STATE.phaseMask, STATE.phaseShift), 2, 'successful reset fixture must be a paid run');
    const resetSeedClient = 0xe13579bd;
    const resetSeedCredit = 0xabcdef98;
    const resetSeedCountdowns = 0x8000cafe;
    setVars(resetPlayer, {
      clientState: resetSeedClient,
      credit: resetSeedCredit,
      state: resetSeedState,
      generation: 80,
      countdowns: resetSeedCountdowns
    });
    resetPlayer.openMainModal(resetGuardModal);
    resetPlayer.openMainOverlay(resetGuardOverlay);
    const resetActors = [
      addActor('barrows_verac', 0, resetPlayer.uid, 3548, 9694),
      addActor('barrows_giantspider', 3, resetPlayer.uid, 3551, 9700)
    ];
    const resetPrimary = addActor('barrows_dharok', 0, ownerB.uid, 3557, 9701, EntityLifeCycle.RESPAWN);
    const resetBeforeBlocked = snapshot(resetPlayer);
    const resetPacketsBeforeBlocked = resetPlayer.packets.length;
    resetPlayer.delayed = true;
    const blockedReset = callProc(resetPlayer, 'barrows_run_reset', [], { target: resetPrimary.npc });
    assert.equal(blockedReset.execution, -1, 'run_reset must reject execution while player access is delayed');
    assert.deepEqual(snapshot(resetPlayer), resetBeforeBlocked, 'inaccessible run_reset must not clear state');
    assert.equal(resetPlayer.packets.length, resetPacketsBeforeBlocked, 'inaccessible run_reset must emit no output');
    assertRetained(resetActors, 'inaccessible run_reset');
    resetPlayer.delayed = false;
    const resetDeletion = observeWorldDeletions(resetPlayer, new Set(resetActors.map(row => row.nid)), () =>
      measureRandom(() => procVoid(resetPlayer, 'barrows_run_reset', [], { target: resetPrimary.npc }))
    );
    assert.equal(resetDeletion.value.calls, 1, 'run_reset draws one replacement rank for the retained corner and entrance');
    assertDeleteOrder(resetDeletion.observations, resetActors, {
      generation: 81,
      state: resetSeedState,
      credit: resetSeedCredit,
      countdowns: resetSeedCountdowns
    }, 'run_reset');
    assertDeleted(resetActors, 'run_reset');
    assertRetained([resetPrimary], 'run_reset for player A');
    assert.equal(u32(resetPlayer.getVar(ids.generation)), 81, 'run_reset must advance generation once');
    assert.equal(u32(resetPlayer.getVar(ids.credit)), 0, 'run_reset must clear all of varp 453');
    assert.equal(u32(resetPlayer.getVar(ids.countdowns)), 0, 'run_reset must clear both saved countdowns');
    assert.equal(u32(resetPlayer.getVar(ids.state)) & ~(STATE.cornerMask | STATE.entranceMask), stateHigh(resetSeedState), 'run_reset clears progression while preserving upper bits and writing idle layout selectors');
    assert.equal(field(resetPlayer.getVar(ids.state), STATE.cornerMask, STATE.cornerShift), field(resetSeedState, STATE.cornerMask, STATE.cornerShift), 'run_reset retains the previous ladder corner selector');
    assert.equal(field(resetPlayer.getVar(ids.state), STATE.entranceMask, STATE.entranceShift), field(resetSeedState, STATE.entranceMask, STATE.entranceShift), 'run_reset retains the previous central entrance selector');
    assert.equal(procInt(resetPlayer, 'barrows_phase'), 0, 'run_reset must leave the phase idle');
    assertLayout(resetPlayer, resetSeedClient, 'run_reset');
    assert.equal(resetPlayer.modalMain, -1, 'paid run_reset closes its active modal');
    assert.equal(resetPlayer.pendingModalClose, true, 'paid run_reset records the disconnected modal close');
    assert.equal(resetPlayer.overlay, -1, 'paid run_reset closes its overlay');
    assert(resetPlayer.packets.some(packet => packet.constructor.name === 'CamReset'), 'paid run_reset resets camera presentation');
    removeFixtures();

    // A new run after reset increments again, draws a fresh identity and connected
    // layout; the prior generation is stale.
    const postResetClient = 0x76543210;
    const postResetState = stateWord({ high: 0x6b6b0000, identity: 0, phase: 0, corner: 3, entrance: 2, solved: true, family: 3, permutation: 7, challenge: true });
    setVars(resetPlayer, {
      clientState: postResetClient,
      credit: 0xffffffff,
      state: postResetState,
      generation: 81,
      countdowns: 0x7fffffff
    });
    const postResetBegin = measureRandom(() => procInt(resetPlayer, 'barrows_run_begin'));
    assert.equal(postResetBegin.value, 1, 'a post-reset run must begin successfully');
    assert.equal(postResetBegin.calls, 2, 'a post-reset run draws identity and one global layout seam');
    assert.equal(u32(resetPlayer.getVar(ids.generation)), 82, 'post-reset run must advance generation');
    const postResetIdentity = procInt(resetPlayer, 'barrows_tunnel_identity');
    assert(postResetIdentity >= 1 && postResetIdentity <= 6, 'post-reset run must choose a valid identity');
    assert.equal(u32(resetPlayer.getVar(ids.credit)), 0, 'post-reset run must clear prior credit');
    assert.equal(u32(resetPlayer.getVar(ids.countdowns)), 0, 'post-reset run must clear prior countdowns');
    assert.equal(u32(resetPlayer.getVar(ids.state)) & ~(STATE.cornerMask | STATE.entranceMask), stateHigh(postResetState) | postResetIdentity | (1 << STATE.phaseShift), 'post-reset run clears progression and retains upper bits');
    assertLayout(resetPlayer, postResetClient, 'post-reset run_begin');
    assert.notEqual(field(resetPlayer.getVar(ids.state), STATE.cornerMask, STATE.cornerShift), 3, 'post-reset begin excludes the previous ladder corner');
    assert.notEqual(field(resetPlayer.getVar(ids.state), STATE.entranceMask, STATE.entranceShift), 2, 'post-reset begin excludes the previous central entrance');
    const staleAfterReset = snapshot(resetPlayer);
    assert.equal(procInt(resetPlayer, 'barrows_search_allowed', [81]), 0, 'the previous run generation must be stale after reset and a new begin');
    assert.deepEqual(snapshot(resetPlayer), staleAfterReset, 'stale Search authorization must not mutate the new run');
    assert.equal(procInt(resetPlayer, 'barrows_search_allowed', [82]), 1, 'the newly begun generation must authorize a valid tunnel Search guard');

    // Resume clears the active challenge and arms the one-tick timer without
    // refreshing either positive saved countdown.
    const resumePlayer = makePlayer('resume');
    const resumeSeedState = stateWord({ high: 0x9abc0000, identity: 2, phase: 2, corner: 3, entrance: 1, solved: true, family: 2, permutation: 5, challenge: true });
    const resumeSeed = {
      clientState: 0x3cc35aa5,
      credit: 0xdabc1234,
      state: resumeSeedState,
      generation: 670,
      countdowns: 0xf00dbeef
    };
    setVars(resumePlayer, resumeSeed);
    const resumeBefore = snapshot(resumePlayer);
    const resumeTimerCount = resumePlayer.timers.size;
    const resume = measureRandom(() => {
      procVoid(resumePlayer, 'barrows_resume');
      return snapshot(resumePlayer);
    });
    assert.equal(resume.calls, 0, 'barrows_resume must not draw randomness');
    assert.deepEqual(resume.value, {
      ...resumeBefore,
      state: u32(resumeSeedState & ~STATE.challengeMask)
    }, 'barrows_resume may clear only the active-challenge bit');
    assert.equal(resumePlayer.timers.size, resumeTimerCount + 1, 'barrows_resume arms the one-tick timer from the saved remainder');
    assert.equal(procInt(resumePlayer, 'barrows_prayer_remaining'), 0xbeef, 'resume must retain the exact prayer countdown half');
    assert.equal(procInt(resumePlayer, 'barrows_collapse_remaining'), 0xf00d, 'resume must retain the exact collapse countdown half');

    // Countdown storage is two unsigned halves. Exercise the upper-half sign
    // bit, both clamp endpoints, opposite-half preservation, and pure step math.
    setVars(resumePlayer, { countdowns: 0x8000beef });
    procVoid(resumePlayer, 'barrows_prayer_set', [65536]);
    assert.equal(u32(resumePlayer.getVar(ids.countdowns)), 0x8000ffff, 'prayer setter must clamp to 65535 and preserve a signed upper half');
    assert.equal(procInt(resumePlayer, 'barrows_collapse_remaining'), 0x8000, 'collapse getter must read an unsigned high half');
    procVoid(resumePlayer, 'barrows_prayer_set', [-17]);
    assert.equal(u32(resumePlayer.getVar(ids.countdowns)), 0x80000000, 'prayer setter must clamp negative values to zero and preserve the high half');
    assert.equal(procInt(resumePlayer, 'barrows_prayer_remaining'), 0, 'prayer getter must retain the clamped zero');

    setVars(resumePlayer, { countdowns: 0xabcd1234 });
    procVoid(resumePlayer, 'barrows_collapse_set', [70000]);
    assert.equal(u32(resumePlayer.getVar(ids.countdowns)), 0xffff1234, 'collapse setter must clamp to 65535 and preserve the low half');
    assert.equal(procInt(resumePlayer, 'barrows_collapse_remaining'), 0xffff, 'collapse getter must read 65535 unsigned');
    procVoid(resumePlayer, 'barrows_collapse_set', [-1]);
    assert.equal(u32(resumePlayer.getVar(ids.countdowns)), 0x00001234, 'collapse setter must clamp negative values to zero and preserve the low half');

    const stepSnapshot = snapshot(resumePlayer);
    for (const [remaining, interval, next, due] of [
      [0, 17, 0, 0],
      [1, 17, 17, 1],
      [2, 17, 1, 0],
      [65535, 17, 65534, 0],
      [1, 65535, 65535, 1]
    ]) {
      assert.deepEqual(
        procPair(resumePlayer, 'barrows_countdown_step', [remaining, interval]),
        [next, due],
        `countdown_step(${remaining}, ${interval})`
      );
      assert.deepEqual(snapshot(resumePlayer), stepSnapshot, 'countdown_step must remain a pure protocol helper');
    }

    // Each transition also refuses an invocation when protected access is
    // already held; this verifies the engine's real inaccessible-call path.
    const lockedPlayer = makePlayer('protected');
    setVars(lockedPlayer, {
      clientState: 0x778855aa,
      credit: 0x13572468,
      state: stateWord({ high: 0x12340000, identity: 2, phase: 0 }),
      generation: 99,
      countdowns: 0x80004321
    });
    const lockedBefore = snapshot(lockedPlayer);
    assertProtectedDenied(lockedPlayer, 'barrows_run_begin');
    assert.deepEqual(snapshot(lockedPlayer), lockedBefore, 'blocked run_begin must preserve all fields');
    assertProtectedDenied(lockedPlayer, 'barrows_run_reset');
    assert.deepEqual(snapshot(lockedPlayer), lockedBefore, 'blocked run_reset must preserve all fields');

    console.log('OK packed S01 state fields, client masks, phase gates and run generations');
    console.log('OK Search guard/latch, frozen credit, stale generation and non-suspending protected transitions');
    console.log('OK real World actor cleanup across both Barrows levels, ownership filters, primary NPC and wrap order');
    console.log('OK saved countdown masks, clamps, sign-bit handling, resume retention and pure step protocol');
    console.log('RESULT PASS (compiled Barrows S01 core contract)');
  } finally {
    removeFixtures();
  }
  await checkInertLogin({ World, Player, ScriptProvider, ScriptRunner, ScriptState, loadDefault, eng });
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error);
    process.exit(1);
  }
);
