// Production click handlers, native map locs and packed VM; no world server.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { engine, World, Player, ScriptState, ScriptProvider, types, floorTiles, map, locFor, nativeLocRows, nativeNpcRows, ResumePauseButtonHandler, ResumePauseButton, IfSetText } from '../regicide-travel/runtime.mjs';
const load = async file => (await import(pathToFileURL(path.join(engine, 'src', file)).href)).default;
const Environment = await load('util/Environment.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const OpLocU = await load('network/game/client/model/OpLocU.ts');
const OpLocUHandler = await load('network/game/client/handler/OpLocUHandler.ts');
const OpNpcU = await load('network/game/client/model/OpNpcU.ts');
const OpNpcUHandler = await load('network/game/client/handler/OpNpcUHandler.ts');
const MessageGame = await load('network/game/server/model/MessageGame.ts');
const IfOpenOverlay = await load('network/game/server/model/IfOpenOverlay.ts');
const rsbuf = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href);
const selectedCase = process.argv[2];
let serial = 0;
let passed = 0;
let parentFallback;
function dispatchPath(selected, expected) {
  parentFallback ??= selected !== null;
  assert.equal(selected !== null, parentFallback, 'consistent observed parent-fallback capability');
  if (parentFallback) assert.equal(selected, expected, 'guarded parent path selected');
}
const extraCases = [
  'golem-complete-once', 'golem-stage-0', 'golem-stage-6', 'golem-head-closed',
  ...['mine', 'chop'].flatMap(op => ['none', 'carried', 'worn', 'unusable'].map(tool => `abyss-${op}-${tool}`))
];
const specs = [
  { name: 'rift-unroped', parent: 'soulbane_falloff2_rope_multi', child: 'soulbane_falloff2', state: 0, refused: true },
  { name: 'rift-roped-unstarted', parent: 'soulbane_falloff2_rope_multi', child: 'soulbane_falloff2_rope', state: 1, stage: 0, refused: true },
  { name: 'rift-roped', parent: 'soulbane_falloff2_rope_multi', child: 'soulbane_falloff2_rope', state: 1, stage: 1 },
  { name: 'plinth-placed', parent: 'elid_statuette_multiloc', child: 'elid_statuette_placed', state: 60, item: 'elid_statuette', refused: true },
  ...[0, 10, 20, 25, 27, 30, 35, 40, 50, 55].map(state => ({ name: `plinth-base-${state}`, parent: 'elid_statuette_multiloc', child: 'elid_statuette_base', state, item: 'elid_statuette', gated: state < 50, nextState: 60 })),
  { name: 'altar-pouch', parent: 'devious_altar', child: 'devious_altar_pouch', state: 1, item: 'devious_glowingpouch', refused: true },
  { name: 'altar-scorched', parent: 'devious_altar', child: 'devious_altar_scorched', state: 2, item: 'devious_glowingpouch', refused: true },
  { name: 'altar-empty', parent: 'devious_altar', child: 'altar', state: 0, item: 'devious_glowingpouch', nextState: 1 }
];
assert(!selectedCase || [...specs.map(s => s.name), ...extraCases].includes(selectedCase), 'unknown case');
for (const spec of specs.filter(s => !selectedCase || s.name === selectedCase)) {
  const p = new Player('guard_' + ++serial, BigInt(serial), BigInt(serial));
  Object.assign(p, { slot: serial, pid: serial, uid: (serial << 11) | serial, isActive: true });
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99);
  World.players[serial] = p; rsbuf.addPlayer(serial);
  const packets = []; p.write = packet => packets.push(packet);
  const executions = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    executions.push({ script: state.script.name, activeLoc: state._activeLoc?.type, state });
    return execute.call(this, state, ...args);
  };
  const root = types.LocType.getByName(spec.parent);
  assert(root && root.multivarbit >= 0);
  const native = nativeLocRows(spec.parent)[0];
  assert(native, 'native placement');
  const entity = locFor(native);
  assert(entity, 'native packed loc');
  const approaches = [];
  for (let x = entity.x - 4; x <= entity.x + 4; x++) for (let z = entity.z - 4; z <= entity.z + 4; z++) {
    if (!floorTiles.has([entity.level, x, z].join(',')) || map.isMapBlocked(x, z, entity.level)) continue;
    Object.assign(p, { level: entity.level, x, z });
    if (p.inOperableDistance(entity)) approaches.push([entity.level, x, z]);
  }
  approaches.sort((a, b) => Math.abs(a[1] - entity.x) + Math.abs(a[2] - entity.z) - Math.abs(b[1] - entity.x) - Math.abs(b[2] - entity.z));
  assert(approaches.length, 'genuine operable floor approach');
  [p.level, p.x, p.z] = approaches[0];
  p.buildArea.rebuild();
  p.setVarBit(root.multivarbit, spec.state);
  if (spec.stage !== undefined) p.setVarBit(types.VarBitType.getId('soulbane_prog'), spec.stage);
  assert.equal(types.LocType.get(root.multiloc[spec.state]).debugname, spec.child, 'fixture shown form');
  const invId = types.InvType.getId('inv');
  const inv = p.getInventory(invId);
  const item = spec.item ? types.ObjType.getId(spec.item) : -1;
  if (spec.item) {
    assert(item >= 0);
    inv.add(item, 2);
    const com = types.Component.get(3214);
    assert(com.usable);
    p.tabs[3] = com.rootLayer;
    p.invListenOnCom(invId, com.id, p.uid);
  }
  const snapshot = () => ({ coordinates: [p.level, p.x, p.z], itemCount: spec.item ? inv.getItemCount(item) : null, state: p.getVarBit(root.multivarbit) });
  const before = snapshot();
  const beforeVars = Array.from(p.vars);
  const beforeStats = Array.from(p.stats);
  const accepted = spec.item
    ? new OpLocUHandler().handle(new OpLocU(entity.x, entity.z, root.id, item, 0, 3214), p)
    : new OpLocHandler().handle(new OpLoc(1, entity.x, entity.z, root.id), p);
  assert.equal(accepted, true, 'production click accepted');
  assert.equal(p.target, entity);
  assert(p.validateTarget());
  const selected = p.getOpTrigger()?.name ?? null;
  // The published engine selects no handler for refused forms. The repaired
  // engine selects the guarded parent. Assert identical player outcomes below.
  if (!spec.refused) assert(selected, 'working child-bound handler');
  if (spec.refused && spec.stage === 0) assert.equal(selected, '[oploc1,soulbane_falloff2_rope]', 'unstarted quest reaches the native roped-rift gate');
  else if (spec.refused) dispatchPath(selected, `[${spec.item ? 'oplocu' : 'oploc1'},${spec.parent}]`);
  let reached = false;
  for (let i = 0; i < 3 && !reached; i++) reached = p.tryInteract(true);
  assert(reached, 'click processed');
  for (const { state } of executions) {
    for (let i = 0; state.execution === ScriptState.SUSPENDED && i < 15; i++) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, 'VM did not abort');
  }
  const after = snapshot();
  const messages = packets.filter(p => p instanceof MessageGame).map(p => p.msg);
  const overlays = packets.filter(p => p instanceof IfOpenOverlay).map(p => p.component);
  const changedVars = Array.from(p.vars).flatMap((value, id) => value !== beforeVars[id] ? [{ id, before: beforeVars[id], after: value }] : []);
  const observed = { case: spec.name, native, selected, before, after, messages, overlays, overlay: p.overlay, changedVars, executions: executions.map(({ state, ...e }) => ({ ...e, execution: state.execution })) };
  console.log('OBSERVED ' + JSON.stringify(observed));
  if (spec.refused || spec.gated) {
    assert.deepEqual(after, before, `${spec.name}: no movement, item loss or selector change`);
    assert.deepEqual(changedVars, [], `${spec.name}: no varp write`);
    assert.equal(p.overlay, -1, `${spec.name}: no deferred overlay`);
    assert.deepEqual(overlays, [], `${spec.name}: no overlay`);
    assert.equal(messages.filter(m => m === 'Nothing interesting happens.').length, 1, 'published default message');
    // Debug servers additionally diagnose a missing handler. It is not a
    // player-facing content message and is absent when a guard executes.
    assert(messages.every(m => m === 'Nothing interesting happens.' || m.startsWith('No trigger for ')), 'no new content wording');
    if (spec.parent === 'elid_statuette_multiloc') {
      assert.deepEqual(Array.from(p.stats), beforeStats, 'unearned/replayed placement grants no XP');
      assert.equal(p.modalMain, -1, 'unearned/replayed placement opens no scroll');
    }
    if (selected) {
      assert(executions.length > 0, 'guarded handler executed, not bypassed');
      for (const e of executions) {
        assert.equal(e.script, selected, 'refusal came from the selected guarded path');
        assert.equal(e.state.execution, ScriptState.FINISHED, 'guarded handler returned');
      }
    } else assert.equal(executions.length, 0, 'published missing-handler path');
  } else if (!spec.item) {
    const instance = World.instances.findInstanceByCoord(p);
    assert(instance, 'accepted quest descent creates its native private region');
    assert.deepEqual([p.level, p.x - instance.sw.x + 3008, p.z - instance.sw.z + 5184], [0, 3013, 5243], 'descent uses the original cache-room destination');
    assert.equal(after.state, 1, 'descent preserves the attached-rope form');
    assert.equal(p.getVarBit(types.VarBitType.getId('soulbane_prog')), 2, 'accepted stage-1 descent starts Rage');
    assert.equal(p.getVar(types.VarPlayerType.getId('soulbane_instance')), instance.uid + 1, 'descent binds the created region');
    assert.equal(p.overlay, types.Component.getId('rage_level'));
    const musicTable = types.DbTableType.get(types.DbTableType.getId('music'));
    const wrath = types.DbRowType.get(types.DbRowType.getId('music_Wrath_and_Ruin'));
    const unlockColumn = musicTable.columnNames.indexOf('unlock');
    assert(unlockColumn >= 0, 'built music table declares its unlock field');
    const unlock = wrath.columnValues[unlockColumn];
    assert(Array.isArray(unlock) && unlock.length === 2, 'built Wrath row declares its unlock slot and bit');
    const [slot, bit] = unlock;
    assert(Number.isInteger(slot) && Number.isInteger(bit) && bit >= 0 && bit < 32, 'built Wrath unlock is valid');
    const musicVarp = types.VarPlayerType.getId(`musicmulti_${slot}`);
    assert(musicVarp >= 0, 'built Wrath unlock varp exists');
    assert.equal(p.getVar(musicVarp) >>> 0, (beforeVars[musicVarp] | (1 << bit)) >>> 0, 'descent sets only the built Wrath unlock bit');
    const expectedVarps = ['soulbane', 'soulbane_instance'].map(name => types.VarPlayerType.getId(name)).concat(musicVarp);
    assert.deepEqual(changedVars.map(change => change.id).sort((a, b) => a - b), expectedVarps.sort((a, b) => a - b), 'descent writes only its quest progress, temporary region handle and Wrath unlock');
  } else {
    assert.deepEqual(after.coordinates, before.coordinates);
    assert.equal(after.itemCount, before.itemCount - 1);
    assert.equal(after.state, spec.nextState);
    if (spec.parent === 'elid_statuette_multiloc') {
      for (const [stat, reward] of [[PlayerStat.PRAYER, 80000], [PlayerStat.THIEVING, 10000], [PlayerStat.MAGIC, 10000]]) {
        assert.equal(p.stats[stat] - beforeStats[stat], reward * Environment.NODE_XPRATE, 'earned placement grants the period XP');
      }
      const qp = types.VarPlayerType.getId('qp');
      assert.equal(p.getVar(qp), 2, 'earned placement recounts two quest points');
      assert.equal(p.modalMain, types.Component.getId('questscroll_death'), 'earned placement opens the real scroll');
      assert(packets.some(packet => packet instanceof IfSetText && packet.text === 'You have completed Spirits of the Elid.'));
      assert.deepEqual(messages, ['Congratulations! Quest complete!']);
      assert.equal(changedVars.length, 2, 'placement writes only its selector base and quest-point recount');
      assert(changedVars.some(change => change.id === qp && change.before === 0 && change.after === 2));
    } else {
      assert.deepEqual(messages, []);
      assert.equal(changedVars.length, 1, 'placement writes only its selector base');
    }
    assert.deepEqual(overlays, []);
  }
  for (const execution of executions) assert.equal(execution.activeLoc, root.id, 'original parent context');
  passed++;
  console.log('PASS ' + spec.name);
}
assert(ScriptProvider.getByName('[oploc1,soulbane_falloff2_rope]'));
const pause = new ResumePauseButtonHandler();
const statIndex = { woodcutting: 8, crafting: 12, mining: 14, thieving: 17 };
function fixture() {
  const id = ++serial;
  const p = new Player('guard_' + id, BigInt(id), BigInt(id));
  Object.assign(p, { slot: id, pid: id, uid: (id << 11) | id, isActive: true });
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(130344310);
  World.players[id] = p; rsbuf.addPlayer(id);
  const packets = [], executions = [];
  p.write = packet => packets.push(packet);
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    executions.push({ script: state.script.name, state });
    return execute.call(this, state, ...args);
  };
  const invId = types.InvType.getId('inv'), inv = p.getInventory(invId);
  p.tabs[3] = types.Component.get(3214).rootLayer;
  p.invListenOnCom(invId, 3214, p.uid);
  return { p, packets, executions, inv };
}
function approach(p, entity) {
  const candidates = [];
  for (let x = entity.x - 5; x <= entity.x + 5; x++) for (let z = entity.z - 5; z <= entity.z + 5; z++) {
    if (!floorTiles.has([entity.level, x, z].join(',')) || map.isMapBlocked(x, z, entity.level)) continue;
    Object.assign(p, { level: entity.level, x, z });
    if (p.inOperableDistance(entity)) candidates.push([entity.level, x, z]);
  }
  candidates.sort((a, b) => Math.abs(a[1] - entity.x) + Math.abs(a[2] - entity.z) - Math.abs(b[1] - entity.x) - Math.abs(b[2] - entity.z));
  assert(candidates.length, 'native operable floor approach');
  [p.level, p.x, p.z] = candidates[0];
  p.buildArea.rebuild();
}
function varbit(p, name, value) {
  const id = types.VarBitType.getId(name);
  assert(id >= 0, name);
  if (value !== undefined) p.setVarBit(id, value);
  return p.getVarBit(id);
}
function finish(p, executions, from) {
  let reached = false;
  for (let i = 0; i < 3 && !reached; i++) reached = p.tryInteract(true);
  assert(reached, 'production click processed');
  for (let q = 0; q < 3; q++) {
    for (let k = from; k < executions.length; k++) {
      const { state } = executions[k];
      for (let i = 0; state.execution !== ScriptState.FINISHED && i < 60; i++) {
        assert.notEqual(state.execution, ScriptState.ABORTED, state.script.name);
        if (state.execution === ScriptState.PAUSEBUTTON) assert(pause.handle(new ResumePauseButton(0), p));
        else if (state.execution === ScriptState.SUSPENDED) {
          World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
          p.delayed = false;
          p.executeScript(state, true, true);
        } else assert.fail(`unexpected VM state ${state.execution}`);
      }
      assert.equal(state.execution, ScriptState.FINISHED, 'selected handler returned');
    }
    p.processQueues();
  }
}
const messagesOf = packets => packets.filter(p => p instanceof MessageGame).map(p => p.msg);
function publishedDefault(messages) {
  assert.equal(messages.filter(m => m === 'Nothing interesting happens.').length, 1);
  assert(messages.every(m => m === 'Nothing interesting happens.' || m.startsWith('No trigger for ')));
}
function record(name, data) {
  console.log('OBSERVED ' + JSON.stringify({ case: name, enginePath: parentFallback ? 'guarded-parent' : 'published-missing-handler', ...data }));
  passed++;
  console.log('PASS ' + name);
}
for (const name of extraCases.filter(n => n.startsWith('golem-') && (!selectedCase || n === selectedCase))) {
  const { p, packets, executions, inv } = fixture();
  const root = types.NpcType.getByName('golem_golem');
  const native = nativeNpcRows('golem_golem')[0];
  assert(native);
  const npc = [...World.npcs].find(n => n.type === root.id && n.level === native.level && n.x === native.x && n.z === native.z);
  assert(npc, 'native packed golem');
  approach(p, npc);
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump, p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance, p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ, p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type, p.levels[3], p.baseLevels[3], p.animId, p.animDelay, p.sayMessage, p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0, p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump, npc.runDir, npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX, npc.faceSquareZ, npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage, npc.hitmark2Type, npc.levels[3], npc.baseLevels[3], npc.animId, npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'native NPC visible');
  const program = types.ObjType.getId('golem_program'), key = types.ObjType.getId('golem_golemkey');
  inv.add(program, 1); inv.add(key, 1);
  const stage = name === 'golem-stage-0' ? 0 : name === 'golem-stage-6' ? 6 : 7;
  varbit(p, 'golem_a', stage); varbit(p, 'golem_clay', 4);
  varbit(p, 'golem_head_open', name === 'golem-head-closed' ? 0 : 1);
  const rounds = [];
  for (let round = 0; round < (name === 'golem-complete-once' ? 2 : 1); round++) {
    const before = { stage: varbit(p, 'golem_a'), xp: [p.stats[12], p.stats[17]], vars: Array.from(p.vars), tile: [p.level, p.x, p.z], items: inv.items.map(i => i && { ...i }) };
    const from = executions.length, start = packets.length;
    assert.equal(new OpNpcUHandler().handle(new OpNpcU(npc.nid, program, 0, 3214), p), true);
    assert.equal(p.target, npc);
    const selected = p.getOpTrigger()?.name ?? null;
    dispatchPath(selected, '[opnpcu,golem_golem]');
    finish(p, executions, from);
    const after = { stage: varbit(p, 'golem_a'), xp: [p.stats[12], p.stats[17]], vars: Array.from(p.vars), tile: [p.level, p.x, p.z], items: inv.items.map(i => i && { ...i }) };
    const messages = messagesOf(packets.slice(start));
    const scripts = executions.slice(from).map(e => ({ script: e.script, execution: e.state.execution }));
    if (selected) assert(scripts.some(e => e.script === selected), 'guarded NPC handler executed');
    else assert.deepEqual(scripts, [], 'published engine has no NPC item-use handler');
    const completes = selected && name === 'golem-complete-once' && round === 0;
    assert.deepEqual(after.xp.map((v, i) => v - before.xp[i]), completes ? [10000, 10000] : [0, 0], 'XP awarded once only');
    assert.equal(after.stage, completes ? 10 : before.stage);
    assert.deepEqual(after.tile, before.tile);
    assert.deepEqual(after.items, before.items, 'key and program retained');
    if (!completes) {
      assert.deepEqual(after.vars, before.vars, 'refusal writes no varp');
      if (!selected || name !== 'golem-head-closed') publishedDefault(messages);
      else assert.deepEqual(messages, ["You can't see a way to put the instructions in the golem's skkull."]);
    } else {
      assert(scripts.some(e => e.script === '[queue,golem_complete]'), 'real completion queue executed');
      assert(packets.slice(start).some(p => p instanceof IfSetText && p.text.includes('You have completed the Golem quest!')));
    }
    rounds.push({ round: round + 1, selected, before, after, messages, scripts });
    p.closeModal();
  }
  record(name, { native, fixture: { stage, clay: 4, headOpen: name !== 'golem-head-closed', inventory: ['golem_program', 'golem_golemkey'], stats: 99 }, rounds });
}
for (const name of extraCases.filter(n => n.startsWith('abyss-') && (!selectedCase || n === selectedCase))) {
  const [, op, tool] = name.split('-');
  const { p, packets, executions, inv } = fixture();
  const root = types.LocType.getByName('rcu_outer_multi1');
  const native = nativeLocRows(root.debugname)[0], entity = locFor(native);
  assert(entity);
  approach(p, entity);
  const generator = op === 'mine' ? 1 : 2, skill = op === 'mine' ? 'mining' : 'woodcutting', index = statIndex[skill];
  p.setVarBit(root.multivarbit, generator);
  const shown = types.LocType.get(root.multiloc[generator]);
  assert.equal(shown.op[0], op === 'mine' ? 'Mine' : 'Chop');
  if (tool !== 'none') {
    const id = types.ObjType.getId(op === 'mine' ? 'rune_pickaxe' : 'rune_axe');
    if (tool === 'worn') p.getInventory(types.InvType.getId('worn')).set(3, { id, count: 1 });
    else inv.add(id, 1);
    if (tool === 'unusable') p.levels[index] = p.baseLevels[index] = 1;
  }
  const snapshot = () => ({ tile: [p.level, p.x, p.z], xp: p.stats[index], vars: Array.from(p.vars), generator: p.getVarBit(root.multivarbit) });
  const before = snapshot();
  assert.equal(new OpLocHandler().handle(new OpLoc(1, entity.x, entity.z, root.id), p), true);
  assert.equal(p.target, entity);
  const selected = p.getOpTrigger()?.name ?? null;
  dispatchPath(selected, '[oploc1,rcu_outer_multi1]');
  finish(p, executions, 0);
  const after = snapshot(), messages = messagesOf(packets);
  const scripts = executions.map(e => ({ script: e.script, execution: e.state.execution }));
  if (selected) assert(scripts.some(e => e.script === selected), 'guarded obstacle handler executed');
  else assert.deepEqual(scripts, []);
  if (!selected || tool === 'none' || tool === 'unusable') {
    assert.deepEqual(after, before, 'no tool or unusable tool: no passage, XP or state change');
    if (!selected) publishedDefault(messages);
    else assert.deepEqual(messages, op === 'mine'
      ? ['You need a pickaxe for which you have the required Mining level to mine this rock.']
      : ['You attempt to chop your way through...', 'You need an axe to chop down this tree.', 'You do not have an axe which you have the level to use.']);
  } else {
    // rcu_outer_multi1's published rcu_outer_inner_coord, not a synthetic route.
    assert.deepEqual(after.tile, [0, 3042, 4819], 'published handler passage');
    assert.equal(after.xp - before.xp, 250, 'published handler XP in tenths');
    assert.equal(after.generator, 0);
    assert(messages.includes(op === 'mine' ? '...and manage to break through the rock.' : '...and manage to cut a way through the tendrils.'));
  }
  record(name, { native, shown: shown.debugname, selected, fixture: { generator, tool, skillLevel: p.levels[index] }, before, after, messages, scripts });
}
console.log(`MULTIFORM_GUARDS_PASS=${passed}`);
process.exit(0);
