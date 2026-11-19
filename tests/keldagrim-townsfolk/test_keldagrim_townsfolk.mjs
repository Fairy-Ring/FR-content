import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  BlockWalk, EntityLifeCycle, IfSetText, MessageGame, Npc, Player,
  ResumePauseButton, ResumePauseButtonHandler, ScriptRunner, ScriptState,
  ServerTriggerType, World, engine, floorTiles, map, nativeNpcRows, requiredId, types
} from '../regicide-travel/runtime.mjs';

const JavaRandom = (await import(pathToFileURL(resolve(engine, 'src/util/JavaRandom.ts')).href)).default;
const { PlayerLoading } = await import(pathToFileURL(resolve(engine, 'src/engine/entity/PlayerLoading.ts')).href);
const Packet = (await import(pathToFileURL(resolve(engine, 'src/io/Packet.ts')).href)).default;
const ScriptProvider = (await import(pathToFileURL(resolve(engine, 'src/engine/script/ScriptProvider.ts')).href)).default;
const { ScriptOpcode } = await import(pathToFileURL(resolve(engine, 'src/engine/script/ScriptOpcode.ts')).href);
const slices = ['crowds', 'west', 'east', 'palace', 'inns'].map(name =>
  JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8')));
const counts = JSON.parse(readFileSync(new URL('./conversation-counts.json', import.meta.url), 'utf8'));
const scriptNames = ['keldagrim_crowds', 'keldagrim_west_townsfolk', 'keldagrim_east_townsfolk', 'keldagrim_palace', 'keldagrim_inns'];
const handlers = scriptNames.flatMap(name => [...readFileSync(new URL(`../../scripts/areas/area_keldagrim/scripts/${name}.rs2`, import.meta.url), 'utf8')
  .matchAll(/^\[(opnpc[1-5]),([^\]]+)\]/gm)].map(match => `${match[1]},${match[2]}`)).sort();
assert.deepEqual(handlers, [...new Set(slices.flatMap(slice => slice.scenarios.map(scenario => `opnpc1,${scenario.npc}`)))].sort(),
  'only the assigned exact visible-form Talk handlers are added');
for (const npc of new Set(slices.flatMap(slice => slice.scenarios.map(scenario => scenario.npc)))) {
  const scenarios = slices.flatMap(slice => slice.scenarios.filter(scenario => scenario.npc === npc));
  const placements = nativeNpcRows(scenarios[0].placedNpc ?? npc);
  const stages = new Set(scenarios.map(scenario => scenario.vars.giantdwarf_quest));
  if (placements.some(row => row.mz === 159 && (row.mx === 44 || row.mx === 45))) {
    assert.ok(stages.has(1) && stages.has(2), `${npc}: both normally reachable city stages have full source fixtures`);
  }
  if (placements.some(row => row.mx === 44 && row.mz === 158)) {
    assert.ok(stages.has(0), `${npc}: the southern mine conversation is covered before the first voyage`);
  }
}
const approaches = new Map();
const id = (kind, name) => requiredId(types[kind], name);
const pause = new ResumePauseButtonHandler();
const packets = new WeakMap();
let serial = 0;
let passed = 0;
const failures = [];
const normal = (value, p) => value.replaceAll('<displayname>', p.displayName)
  .replace(/<[^>]*>/g, '').replaceAll('|', ' ').replace(/\s+/g, ' ').trim();
const boatmenForms = ['dwarfrock_boatman_bruv1', 'dwarfrock_boatman_bruv2', 'dwarfrock_boatman_bruv3'];
const ordinaryMasks = new Map([
  ['dwarf_city_drunken_dwarf', 1], ['dwarf_city_drunken_kebab', 1],
  ...boatmenForms.map(npc => [npc, 2])
]);
const gaussClink = { player: id('SeqType', 'human_clink_beerglass'), npc: id('SeqType', 'dwarf_clink_beerglass') };
function canonicalNpcTurns(turns, player) {
  const result = [];
  for (const turn of turns) {
    const name = normal(turn.name, player), text = normal(turn.text, player);
    const previous = result.at(-1);
    if (previous?.name === name) previous.text += ` ${text}`;
    else result.push({ name, text });
  }
  return result;
}

function actor(row, scenario, branch) {
  const n = ++serial;
  const p = new Player(`n619k_${n}`, BigInt(n), 0n);
  p.slot = 1; p.pid = 1;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | p.slot) >>> 0;
  p.vars.fill(0); p.levels.fill(99); p.baseLevels.fill(99);
  p.gender = scenario.gender ?? 0;
  p.level = row.level; p.x = row.x; p.z = row.z;
  p.buildArea.originX = Math.floor(p.x / 8) * 8;
  p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  for (const [name, value] of Object.entries({ ...scenario.vars, ...branch.vars })) {
    const bit = types.VarBitType.getId(name);
    if (bit !== -1) p.setVarBit(bit, value);
    else p.setVar(id('VarPlayerType', name), value);
  }
  const inventory = p.getInventory(id('InvType', 'inv'));
  for (const [name, count] of Object.entries(branch.items ?? scenario.items ?? {})) inventory.add(id('ObjType', name), count);
  World.players[p.slot] = p;
  packets.set(p, []); p.write = packet => packets.get(p).push(packet);
  return p;
}

function readPage(p, output) {
  const text = packets.get(p).filter(packet => packet instanceof IfSetText);
  const rows = text.map(packet => ({ name: types.Component.get(packet.component).debugname, text: normal(packet.text, p), component: packet.component }));
  let npcName;
  const npcWords = output.npcTurns ? [] : null;
  for (const row of rows) {
    const match = /^(npcchat|chat)\d:com_(\d+)$/.exec(row.name);
    if (match?.[1] === 'npcchat' && Number(match[2]) === 1) npcName = row.text;
    if (match && Number(match[2]) >= 2) {
      const kind = match[1] === 'npcchat' ? 'npc' : 'player';
      output[kind].push(row.text);
      if (kind === 'npc' && npcWords) npcWords.push(row.text);
    }
    if (/^message\d:com_\d+$/.test(row.name)) output.game.push(row.text);
  }
  if (npcWords?.length) {
    assert.ok(npcName, 'each multi-NPC page renders its source speaker name');
    output.npcTurns.push({ name: npcName, text: npcWords.join(' ') });
  }
  for (const packet of packets.get(p)) if (packet instanceof MessageGame) output.game.push(normal(packet.msg, p));
  packets.get(p).length = 0;
  const menu = [2, 3, 4, 5].find(count => p.modalChat === id('Component', `multi${count}`));
  if (!menu) return null;
  const options = Array.from({ length: menu }, (_, index) => rows.find(row => row.name === `multi${menu}:com_${index + 1}`));
  assert.ok(options.every(Boolean), 'every menu option is rendered by the production script');
  output.menus.push(options.map(row => row.text));
  return options;
}

function run(scenario, branch, existing = null) {
  const rows = nativeNpcRows(scenario.placedNpc ?? scenario.npc);
  assert.ok(rows.length, `${scenario.npc}: original target map placement exists`);
  const row = rows.find(row => ['44,158', '44,159', '45,159'].includes(`${row.mx},${row.mz}`));
  assert.ok(row, `${scenario.npc}: assigned city/mines map placement`);
  if (!approaches.has(scenario.npc)) {
    const approach = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [row.level, row.x + dx, row.z + dz])
      .find(([level, x, z]) => floorTiles.has(`${level},${x},${z}`) && !map.isMapBlocked(x, z, level) && map.reachedEntity(level, x, z, row.x, row.z, 1, 1, 1));
    assert.ok(approach, 'a normal player can stand beside the original NPC');
    approaches.set(scenario.npc, approach);
    console.log(`FIXTURE ${scenario.npc} approach=${approach.join(',')}`);
  }
  const type = types.NpcType.get(id('NpcType', scenario.npc));
  assert.match(type.op[0], /^Talk/, 'the visible form has its unchanged target Talk option');
  const npc = new Npc(row.level, row.x, row.z, 1, 1, EntityLifeCycle.RESPAWN, ++serial, type.id, BlockWalk.NONE);
  npc.isActive = true; npc.lastMovement = -100;
  const p = existing ?? actor(row, scenario, branch);
  World.players[p.slot] = p;
  const before = ['giantdwarf_quest', 'forget_quest', 'dwarfrock_quest'].map(name => p.getVarBit(id('VarBitType', name)));
  const ordinaryBefore = p.getVar(id('VarPlayerType', 'ordinary_dialogue_bits'));
  const toastInventory = scenario.npc === 'dwarf_city_dwarf_man6' ? p.getInventory(id('InvType', 'inv')) : null;
  const toastExpected = toastInventory && (toastInventory.getItemCount(id('ObjType', 'beer')) > 0
    || toastInventory.getItemCount(id('ObjType', 'dwarven_stout')) > 0);
  const toastFrames = toastInventory ? [] : null;
  if (boatmenForms.includes(scenario.npc)) assert.ok(branch.npcTurns?.length, 'the boatmen source fixture identifies every NPC speaker');
  const originalRandom = JavaRandom.nextDouble;
  const random = [...(branch.random ?? [])];
  JavaRandom.nextDouble = () => {
    assert.ok(random.length, 'every random draw has a source-outcome fixture');
    return random.shift();
  };
  const output = { npc: [], player: [], game: [], menus: [], npcTurns: branch.npcTurns ? [] : null };
  const choices = [...branch.choices];
  try {
    p.target = npc; p.targetOp = ServerTriggerType.OPNPC1 - 7;
    const script = p.getOpTrigger();
    assert.ok(script, 'production dispatch resolves the visible form');
    assert.equal(script.name, `[opnpc1,${scenario.npc}]`, 'exact visible-form handler, not a category fallback');
    const state = ScriptRunner.init(script, p, npc);
    p.executeScript(state, true);
    if (branch.afterVars?.ordinary_dialogue_bits !== undefined) {
      assert.equal(p.getVar(id('VarPlayerType', 'ordinary_dialogue_bits')), branch.afterVars.ordinary_dialogue_bits,
        'the saved first-talk write occurs before the first displayed page');
    }
    for (let step = 0; state.execution !== ScriptState.FINISHED && step < 400; step++) {
      if (toastFrames) toastFrames.push([p.animId, p.animDelay, npc.animId, npc.animDelay]);
      assert.notEqual(state.execution, ScriptState.ABORTED, 'compiled conversation does not abort');
      const menu = readPage(p, output);
      if (state.execution === ScriptState.PAUSEBUTTON) {
        let component = 0;
        if (menu) {
          const wanted = choices.shift();
          assert.ok(wanted, 'no unexpected menu or loop');
          const option = menu.find(option => option.text === normal(wanted, p));
          assert.ok(option, `source menu offers ${wanted}`);
          component = option.component; p.lastCom = component;
        }
        assert.ok(pause.handle(new ResumePauseButton(component), p), 'production Continue/choice handler accepts the click');
      } else if (state.execution === ScriptState.SUSPENDED) {
        World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
        p.delayed = false; p.executeScript(state, true, true);
      } else assert.fail(`unexpected script state ${state.execution}`);
    }
    if (toastFrames) toastFrames.push([p.animId, p.animDelay, npc.animId, npc.animDelay]);
    readPage(p, output);
    assert.equal(state.execution, ScriptState.FINISHED, 'whole conversation completes within its fixed bound');
    assert.deepEqual(choices, [], 'every source path choice is consumed');
    assert.deepEqual(random, [], 'every pinned random outcome is consumed');
    assert.deepEqual(output.menus, branch.menus.map(menu => menu.map(line => normal(line, p))), 'all menus match the independent transcript');
    for (const kind of ['npc', 'player', 'game']) {
      assert.equal(normal(output[kind].join(' '), p), normal((branch[kind] ?? []).join(' '), p), `${kind}: exact source wording and order, including pagination`);
      for (const line of branch[kind] ?? []) assert.ok((scenario.allowed[kind] ?? []).includes(line), `${kind}: fixture line is retained in source allowlist`);
    }
    if (branch.npcTurns) assert.deepEqual(canonicalNpcTurns(output.npcTurns, p), canonicalNpcTurns(branch.npcTurns, p),
      'each boatman speaks the source words in source speaker order, independent of pagination');
    for (const menu of branch.menus) for (const line of menu) assert.ok(scenario.allowed.options.includes(line), 'every menu caption is retained in source allowlist');
    assert.deepEqual(['giantdwarf_quest', 'forget_quest', 'dwarfrock_quest'].map(name => p.getVarBit(id('VarBitType', name))), before, 'ordinary dialogue writes no quest stage');
    const ordinaryAfter = p.getVar(id('VarPlayerType', 'ordinary_dialogue_bits'));
    const ownMask = ordinaryMasks.get(scenario.npc) ?? 0;
    assert.equal(ordinaryAfter & ~ownMask, ordinaryBefore & ~ownMask, 'each conversation preserves every ordinary bit except its own assigned first-talk bit');
    const inventory = p.getInventory(id('InvType', 'inv'));
    for (const [name, count] of Object.entries(branch.afterItems ?? {})) assert.equal(inventory.getItemCount(id('ObjType', name)), count, `real pub transaction ${name}`);
    if (toastFrames) {
      assert.equal(toastFrames.some(frame => frame[0] === gaussClink.player || frame[2] === gaussClink.npc),
        toastExpected, 'only an accepted beer or stout starts the sourced clink');
      if (toastExpected) assert.ok(toastFrames.some(frame => frame[0] === gaussClink.player && frame[1] === 0
        && frame[2] === gaussClink.npc && frame[3] === 0), 'the player and Gauss perform the original paired clink sequences together');
    }
    for (const [name, value] of Object.entries(branch.afterVars ?? {})) {
      const bit = types.VarBitType.getId(name);
      assert.equal(bit === -1 ? p.getVar(id('VarPlayerType', name)) : p.getVarBit(bit), value, `ordinary first-talk state ${name}`);
    }
    return p;
  } finally {
    JavaRandom.nextDouble = originalRandom;
    World.players[p.slot] = null;
  }
}

const actualCounts = {};
for (const slice of slices) for (const scenario of slice.scenarios) {
  const key = `${scenario.npc}/${scenario.state}`;
  assert.ok(!(key in actualCounts), `unique NPC-state fixture ${key}`);
  actualCounts[key] = scenario.branches.length;
  for (const [index, branch] of scenario.branches.entries()) {
    try { run(scenario, branch); passed++; console.log(`PASS ${key} branch ${index + 1}`); }
    catch (error) { failures.push({ case: `${key}/${index + 1}`, error: String(error.stack ?? error) }); console.error(`FAIL ${key}/${index + 1}: ${error}`); }
  }
}

// Exercise product-written state on one player, then the actual saved-player decoder.
const firstTalkVarp = types.VarPlayerType.get(id('VarPlayerType', 'ordinary_dialogue_bits'));
assert.equal(firstTalkVarp.id, 191, 'operator-assigned original slot');
assert.equal(firstTalkVarp.scope, types.VarPlayerType.SCOPE_PERM, 'first-talk state survives logout');
assert.equal(firstTalkVarp.transmit, false, 'ordinary first-talk bits have no client reader');
const ordinaryReaders = new Set(), ordinaryWriters = new Set();
for (const line of readFileSync(new URL('../../pack/script.pack', import.meta.url), 'utf8').split('\n')) {
  const match = /^(\d+)=/.exec(line);
  if (!match) continue;
  const script = ScriptProvider.get(Number(match[1]));
  if (!script) continue;
  for (let pc = 0; pc < script.opcodes.length; pc++) {
    const opcode = script.opcodes[pc], operand = script.intOperands[pc] & 0xffff;
    if (opcode === ScriptOpcode.PUSH_VARBIT || opcode === ScriptOpcode.POP_VARBIT) {
      assert.notEqual(types.VarBitType.get(operand)?.basevar, firstTalkVarp.id, 'no client VarBitType aliases the ordinary saved varp');
    }
    if ((opcode !== ScriptOpcode.PUSH_VARP && opcode !== ScriptOpcode.POP_VARP) || operand !== firstTalkVarp.id) continue;
    assert.match(script.info.sourceFilePath, /(?:^|\/)keldagrim_(?:east|west)_townsfolk\.rs2$/, 'only the authorized ordinary first-talk conversations access this shared varp');
    (opcode === ScriptOpcode.PUSH_VARP ? ordinaryReaders : ordinaryWriters).add(script.name);
  }
}
assert.equal(ordinaryReaders.size, 2, 'one shared reader for each authorized first-talk conversation');
assert.deepEqual(ordinaryWriters, ordinaryReaders, 'the two shared first-talk labels own their respective writes');
for (const family of [
  { name: 'town dwarf', slice: 'east', forms: Array(3).fill('dwarf_city_drunken_dwarf'), stage: 2, mask: 1, reservedBits: 0xda5a5a5a | 0 },
  { name: 'shared boatmen', slice: 'west', forms: boatmenForms, stage: 0, mask: 2, reservedBits: 0xda5a5a59 | 0 }
]) {
  const scenarios = slices.find(slice => slice.slice === family.slice).scenarios;
  const initial = scenarios.find(scenario => scenario.npc === family.forms[0] && scenario.vars.giantdwarf_quest === family.stage
    && (scenario.gender ?? 0) === 0 && scenario.vars.ordinary_dialogue_bits === 0);
  assert.ok(initial, `${family.name}: complete initial source conversation`);
  const later = family.forms.slice(1).map(npc => scenarios.find(scenario => scenario.npc === npc
    && (scenario.gender ?? 0) === 0 && scenario.vars.ordinary_dialogue_bits === family.mask
    && Object.entries(initial.vars).every(([name, value]) => name === 'ordinary_dialogue_bits' || scenario.vars[name] === value)));
  assert.ok(later.every(Boolean), `${family.name}: complete subsequent source conversations`);
  const talkedBits = family.reservedBits | family.mask;
  const player = run(initial, { ...initial.branches[0], vars: { ...initial.branches[0].vars, ordinary_dialogue_bits: family.reservedBits },
    afterVars: { ...initial.branches[0].afterVars, ordinary_dialogue_bits: talkedBits } });
  assert.equal(player.getVar(firstTalkVarp.id), talkedBits, `${family.name}: preserve the other assigned bit and every reserved bit, including the sign bit`);
  run(later[0], { ...later[0].branches[0], afterVars: { ...later[0].branches[0].afterVars, ordinary_dialogue_bits: talkedBits } }, player);
  const loaded = PlayerLoading.load(player.username, new Packet(player.save()), null);
  loaded.slot = player.slot; loaded.pid = player.pid; loaded.uid = player.uid;
  packets.set(loaded, []); loaded.write = packet => packets.get(loaded).push(packet);
  assert.equal(loaded.getVar(firstTalkVarp.id), talkedBits, `${family.name}: actual save/load retains the entire shared first-talk varp`);
  run(later[1], { ...later[1].branches[0], afterVars: { ...later[1].branches[0].afterVars, ordinary_dialogue_bits: talkedBits } }, loaded);
  passed += 3;
  console.log(`PASS ${family.name}: initial once, subsequent next talk and subsequent after actual saved-player reload`);
}
assert.deepEqual(actualCounts, counts, 'source conversation counts are pinned separately for every shipped NPC state');
console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} keldagrim-townsfolk: ${passed} passed, ${failures.length} failed, ${Object.keys(counts).length} NPC states`);
if (failures.length) console.error(JSON.stringify(failures, null, 2));
process.exit(failures.length ? 1 : 0);
