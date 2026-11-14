#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, packedId, parseEnum, parseOptions, run } from './packed.mjs';

const options = parseOptions(process.argv);

await run(async () => {
  const runtime = await loadPackedRuntime(options);
  const {
    contentRoot, World, Loc, ScriptProvider, ScriptRunner, ScriptState, VarPlayerType, VarBitType,
    VarNpcType, LocType, NpcType, Component, JavaRandom, EntityLifeCycle, CoordGrid, allocateIfAbsent
  } = runtime;
  const loadEngineModule = relative => import(pathToFileURL(path.join(runtime.engineRoot, 'src', relative)).href);
  const [ServerTriggerType, ResumePauseButton, ResumePauseButtonHandler, GameMap] = await Promise.all([
    loadEngineModule('engine/script/ServerTriggerType.ts'),
    loadEngineModule('network/game/client/model/ResumePauseButton.ts'),
    loadEngineModule('network/game/client/handler/ResumePauseButtonHandler.ts'),
    loadEngineModule('engine/GameMap.ts')
  ]);
  const { changeLocCollision } = GameMap;
  const runner = createRunner(runtime, { prefix: 'barrows_tunnel' });
  const { makePlayer, procInt, measureRandom } = runner;
  const { default: VarSharedType } = await loadEngineModule('cache/config/VarSharedType.ts');
  VarSharedType.load(runtime.packDir);
  World.vars = new Int32Array(VarSharedType.count);

  const requiredProcs = [
    'barrows_tunnel_enter', 'barrows_tunnel_exit', 'barrows_layout_mask', 'barrows_brother_identity'
  ];
  for (const name of requiredProcs) {
    assert(ScriptProvider.getByName(`[proc,${name}]`), `compiled S05/S07 proc missing [proc,${name}]`);
  }
  assert(ScriptProvider.getByName('[oploc1,barrows_ladder]'), 'compiled selected parent-ladder action is missing');

  const varps = {
    client: 'barrows', credit: 'barrows_kills', state: 'barrows_state',
    generation: 'barrows_generation', countdowns: 'barrows_countdowns'
  };
  const ids = Object.fromEntries(Object.entries(varps).map(([field, name]) => {
    const packed = packedId(contentRoot, 'varp', name);
    assert.equal(VarPlayerType.getId(name), packed, `runtime varp id matches pack for ${name}`);
    return [field, packed];
  }));
  const corners = [
    { index: 0, name: 'NW', varbit: 'barrows_chamber_a', ladder: 'barrows_ladder_a', x: 3534, z: 9711 },
    { index: 1, name: 'NE', varbit: 'barrows_chamber_c', ladder: 'barrows_ladder_c', x: 3568, z: 9711 },
    { index: 2, name: 'SW', varbit: 'barrows_chamber_g', ladder: 'barrows_ladder_g', x: 3534, z: 9677 },
    { index: 3, name: 'SE', varbit: 'barrows_chamber_i', ladder: 'barrows_ladder_i', x: 3568, z: 9677 }
  ];
  for (const corner of corners) {
    corner.varbitId = VarBitType.getId(corner.varbit);
    assert.notEqual(corner.varbitId, -1, `packed ladder-visibility varbit exists: ${corner.varbit}`);
    assert.equal(packedId(contentRoot, 'varbit', corner.varbit), corner.varbitId, `${corner.varbit} retains its original id`);
  }

  const brothers = ['ahrim', 'dharok', 'guthan', 'karil', 'torag', 'verac'];
  const sarcJoin = parseEnum(contentRoot, 'barrows_sarcophagus_brother');
  const entryJoin = parseEnum(contentRoot, 'barrows_brother_crypt_entry');
  assert.equal(sarcJoin.size, 6, 'the packed sarcophagus join contains all six brothers');
  assert.equal(entryJoin.size, 6, 'the packed crypt-entry join contains all six brothers');
  const layoutProbe = makePlayer('layout_probe', 3);
  const identities = brothers.map(name => {
    const npcId = NpcType.getId(`barrows_${name}`);
    assert.notEqual(npcId, -1, `packed brother NPC exists: ${name}`);
    assert.equal(sarcJoin.get(`barrow_${name}_sarcophagus`), `barrows_${name}`, `${name} retains its original sarcophagus join`);
    const identity = procInt(layoutProbe, 'barrows_brother_identity', [npcId]);
    assert(identity >= 1 && identity <= 6, `${name} has a valid packed tunnel identity`);
    return { name, identity, npcId, sarcName: `barrow_${name}_sarcophagus` };
  });
  assert.equal(new Set(identities.map(row => row.identity)).size, 6, 'all six brother joins have distinct tunnel identities');

  const regionX = 55;
  const regionZ = 151;
  function nativeLocRows(names) {
    const requested = new Map(names.map(name => [packedId(contentRoot, 'loc', name), name]));
    const file = path.join(contentRoot, 'maps', `m${regionX}_${regionZ}.jm2`);
    assert(fs.existsSync(file), 'the native Barrows map is present');
    let section = '';
    const rows = [];
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) {
        section = line.split(/\s+/)[1];
        continue;
      }
      if (section !== 'LOC') continue;
      const match = line.match(/^([0-3]) (\d+) (\d+): (.*)$/);
      if (!match) continue;
      const fields = match[4].trim().split(/\s+/).map(Number);
      const name = requested.get(fields[0]);
      if (!name) continue;
      rows.push({
        name, id: fields[0], level: Number(match[1]),
        x: regionX * 64 + Number(match[2]), z: regionZ * 64 + Number(match[3]),
        shape: fields[1] ?? 10, angle: fields[2] ?? 0
      });
    }
    assert.equal(rows.length, names.length, `native Barrows map has one placement for each ${names.join(', ')}`);
    assert.equal(new Set(rows.map(row => row.name)).size, names.length, 'native Barrows loc placements are unique');
    return new Map(rows.map(row => [row.name, row]));
  }

  const sarcNames = brothers.map(name => `barrow_${name}_sarcophagus`);
  const sarcRows = nativeLocRows(sarcNames);
  const ladderRows = nativeLocRows(corners.map(corner => corner.ladder));
  for (const name of sarcNames) assert.equal(sarcRows.get(name).level, 3, `${name} is placed in its crypt`);
  for (const corner of corners) {
    const row = ladderRows.get(corner.ladder);
    assert.equal(row.level, 0, `${corner.name} parent ladder is placed in the tunnel level`);
    assert.deepEqual([row.x, row.z], [corner.x, corner.z + 1], `${corner.name} uses its native parent-ladder tile above the landing`);
  }

  const owners = {
    uid: VarNpcType.getId('npc_barrows_owner'), generation: VarNpcType.getId('npc_barrows_generation')
  };
  for (const [name, id] of Object.entries(owners)) assert.notEqual(id, -1, `packed NPC owner field exists: ${name}`);

  const lockVertices = [
    'nw', 'ne', 'sw', 'se', 'n', 'w', 'e', 's', 'center',
    'north_outside', 'west_outside', 'east_outside', 'south_outside'
  ];
  const edges = [
    [['nw', 'north_outside'], ['ne', 'north_outside']],
    [['nw', 'west_outside'], ['sw', 'west_outside']],
    [['nw', 'w']], [['nw', 'n']], [['n', 'center']], [['n', 'ne']],
    [['ne', 'e']], [['ne', 'east_outside'], ['se', 'east_outside']],
    [['w', 'center']], [['center', 'e']], [['w', 'sw']], [['center', 's']],
    [['e', 'se']], [['sw', 's']], [['s', 'se']],
    [['sw', 'south_outside'], ['se', 'south_outside']]
  ];
  const centralLockBits = [4, 8, 9, 11];
  function connected(mask, corner) {
    const neighbors = new Map(lockVertices.map(vertex => [vertex, []]));
    for (let bit = 0; bit < edges.length; bit++) {
      if (((mask >>> bit) & 1) !== 0) continue;
      for (const [left, right] of edges[bit]) {
        neighbors.get(left).push(right);
        neighbors.get(right).push(left);
      }
    }
    const ladderRoom = corners[corner].name.toLowerCase();
    if (neighbors.get(ladderRoom).length !== 1) return false;
    const reached = new Set([ladderRoom]);
    const pending = [ladderRoom];
    while (pending.length) {
      for (const next of neighbors.get(pending.pop())) {
        if (reached.has(next)) continue;
        reached.add(next);
        pending.push(next);
      }
    }
    return lockVertices.filter(vertex => !vertex.endsWith('_outside')).every(vertex => reached.has(vertex));
  }
  function validLayout(mask, corner, entrance) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 0xffff) return false;
    const openCentral = centralLockBits.flatMap((bit, index) => ((mask >>> bit) & 1) === 0 ? [index] : []);
    return openCentral.length === 1 && openCentral[0] === entrance && connected(mask, corner);
  }

  const masksByCornerAndEntrance = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));
  const measuredMasks = measureRandom(() => {
    for (let corner = 0; corner < 4; corner++) {
      for (let entrance = 0; entrance < 4; entrance++) {
        for (let rank = 0; rank < 64; rank++) {
          const mask = procInt(layoutProbe, 'barrows_layout_mask', [entrance, corner, rank]);
          assert(validLayout(mask, corner, entrance), `corner ${corner}, entrance ${entrance}, rank ${rank} connects nine rooms and gives the ladder room one door`);
          masksByCornerAndEntrance[corner][entrance].push(mask);
        }
        assert.equal(new Set(masksByCornerAndEntrance[corner][entrance]).size, 64, 'the packed corner/entrance has all 64 distinct masks');
      }
    }
  });
  assert.equal(measuredMasks.calls, 0, 'the packed layout mask is pure');

  const { makePlayer: makeBarePlayer } = runner;
  const players = [];
  let nextSlot = 0;
  const u32 = value => value >>> 0;
  const snapshot = player => Object.fromEntries(Object.entries(ids).map(([field, id]) => [field, u32(player.getVar(id))]));
  const position = player => [player.level, player.x, player.z];
  const activeNpcs = () => Array.from(World.npcs).filter(npc => npc.isActive);
  const activeNpcIds = () => new Set(activeNpcs().map(npc => npc.nid));
  const newActiveNpcs = before => activeNpcs().filter(npc => !before.has(npc.nid));
  function makeTestPlayer(label) {
    const player = makeBarePlayer(label);
    const slot = ++nextSlot;
    player.slot = player.pid = player.uid = slot;
    player.isActive = true;
    World.players[slot] = player;
    players.push(player);
    return player;
  }
  function setRun(player, identity, corner, entrance, mask, generation) {
    player.setVar(ids.client, u32(0x25 | (1 << (6 + corner)) | (mask << 10)));
    player.setVar(ids.credit, 0);
    player.setVar(ids.state, u32(0xa5a50000 | identity | (1 << 3) | (corner << 5) | (entrance << 7)));
    player.setVar(ids.generation, generation);
    player.setVar(ids.countdowns, 0x12345678);
  }
  function stateIdentity(player) {
    return (u32(player.getVar(ids.state)) >>> 0) & 7;
  }
  function writeIdentity(player, identity) {
    player.setVar(ids.state, u32((u32(player.getVar(ids.state)) & ~7) | identity));
  }
  function writePhase(player, phase) {
    player.setVar(ids.state, u32((u32(player.getVar(ids.state)) & ~0x18) | (phase << 3)));
  }
  function assertLayout(player, expectedCorner) {
    const run = snapshot(player);
    const identity = stateIdentity(player);
    const phase = (run.state >>> 3) & 3;
    const corner = (run.state >>> 5) & 3;
    const entrance = (run.state >>> 7) & 3;
    const mask = (run.client >>> 10) & 0xffff;
    assert(identity >= 1 && identity <= 6, 'the selected tunnel identity is valid');
    assert.equal(phase, 1, 'the tunnel interaction has an active unlooted run');
    assert.equal(corner, expectedCorner, 'the stored corner matches the selected ladder');
    assert(masksByCornerAndEntrance[corner][entrance].includes(mask), 'the lock field matches a connected packed layout mask for the selected corner');
    assert(validLayout(mask, corner, entrance), 'all nine rooms connect and the selected ladder room has exactly one door before transfer');
    assert.deepEqual(
      corners.map(row => player.getVarBit(row.varbitId)),
      corners.map(row => row.index === expectedCorner ? 1 : 0),
      'the original ladder visibility varbits select exactly the stored corner'
    );
    return { identity, phase, corner, entrance, mask };
  }
  function createLoc(row) {
    const type = LocType.get(row.id);
    assert(type, `packed loc type exists: ${row.name}`);
    return new Loc(row.level, row.x, row.z, type.width, type.length, EntityLifeCycle.RESPAWN, row.id, row.shape, row.angle);
  }
  function clipSarcophagus(loc, add) {
    const type = LocType.get(loc.type);
    changeLocCollision(loc.shape, loc.angle, type.blockrange, type.length, type.width, type.active, loc.x, loc.z, loc.level, add);
  }
  function approachSarcophagus(player, row) {
    const type = LocType.get(row.id);
    player.level = row.level;
    player.x = row.x + ((row.angle & 1) === 1 ? type.length : type.width);
    player.z = row.z;
  }
  function chooseLocTrigger(player, loc) {
    player.target = loc;
    player.targetOp = ServerTriggerType.default.OPLOC1 - 7;
    return player.getOpTrigger();
  }
  function runLocAction(player, loc, expectedName) {
    const trigger = chooseLocTrigger(player, loc);
    assert(trigger, `engine native loc dispatch found ${expectedName}`);
    assert.equal(trigger.name, expectedName, `engine native loc dispatch selected ${expectedName}`);
    const state = ScriptRunner.init(trigger, player, loc);
    player.executeScript(state, true, true);
    return { trigger, state };
  }
  function runLifecycleTrigger(player, name) {
    const type = name === 'login' ? ServerTriggerType.default.LOGIN : ServerTriggerType.default.LOGOUT;
    const triggerName = `[${name},_]`;
    const trigger = ScriptProvider.getByTriggerSpecific(type, -1, -1);
    assert(trigger, `compiled ${triggerName} trigger exists`);
    assert.equal(trigger, ScriptProvider.getByName(triggerName), `${triggerName} uses the engine trigger lookup`);
    const state = ScriptRunner.init(trigger, player);
    const result = player.runScript(state, true);
    assert.equal(result, ScriptState.FINISHED, `${triggerName} completes synchronously`);
    assert.equal(state.execution, ScriptState.FINISHED, `${triggerName} finishes`);
    assert.equal(player.activeScript, null, `${triggerName} leaves no suspended script`);
    assert.equal(player.delayed, false, `${triggerName} leaves no delay`);
    assert.equal(player.protect, false, `${triggerName} releases protected access`);
  }
  const pauseHandler = new ResumePauseButtonHandler.default();
  function promptStrings(player) {
    const strings = [...player.messages];
    const visit = (value, seen = new Set()) => {
      if (typeof value === 'string') {
        strings.push(value);
        return;
      }
      if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || seen.has(value)) return;
      seen.add(value);
      for (const child of Object.values(value)) visit(child, seen);
    };
    for (const packet of player.packets) visit(packet);
    return strings;
  }
  const tunnelPrompt = "You've found a hidden tunnel, do you want to enter?";
  function assertTunnelPrompt(player, state) {
    assert(promptStrings(player).includes(tunnelPrompt), 'selected Search emits the exact tunnel prompt text');
    assert.notEqual(player.modalChat, -1, 'selected Search opens the existing Continue chat control');
    for (const menu of ['multi2', 'multi3', 'multi4']) {
      const id = Component.getId(menu);
      if (id !== -1) assert.notEqual(player.modalChat, id, 'selected Search does not compose a choice menu');
    }
    assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'selected Search suspends at the ordinary Continue pause');
    assert.equal(player.activeScript, state, 'the engine retains the same protected Search script');
  }
  function resumeContinue(player, state) {
    assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'Continue resumes the paused script');
    assert.equal(player.activeScript, state, 'Continue targets the captured suspended operation');
    assert(pauseHandler.handle(new ResumePauseButton.default(0), player), 'the engine ResumePauseButtonHandler accepts Continue');
    assert.notEqual(state.execution, ScriptState.ABORTED, 'Continue does not abort the protected Search script');
  }
  function assertNoNewActors(before, label) {
    assert.equal(newActiveNpcs(before).length, 0, `${label} creates no NPC`);
  }
  function entryPosition(name) {
    const text = entryJoin.get(`barrows_${name}`);
    assert(text, `${name} has its original crypt-entry enum destination`);
    const [level, mapX, mapZ, localX, localZ] = text.split('_').map(Number);
    return [level, mapX * 64 + localX, mapZ * 64 + localZ];
  }

  const sarcLocs = new Map(sarcNames.map(name => [name, createLoc(sarcRows.get(name))]));
  const ladderLocs = new Map(corners.map(corner => [corner.index, createLoc(ladderRows.get(corner.ladder))]));
  for (const row of [...sarcRows.values(), ...ladderRows.values()]) {
    for (let dx = -4; dx <= 6; dx++) {
      for (let dz = -4; dz <= 6; dz++) allocateIfAbsent(row.x + dx, row.z + dz, row.level);
    }
  }
  const clippedSarcs = [];

  try {
    for (const loc of sarcLocs.values()) {
      clipSarcophagus(loc, true);
      clippedSarcs.push(loc);
    }

    let generationSeed = 1000;
    for (const identity of identities) {
      const sarcRow = sarcRows.get(identity.sarcName);
      const sarcLoc = sarcLocs.get(identity.sarcName);
      for (const corner of corners) {
        const entrance = (identity.identity + corner.index) % 4;
        const layouts = masksByCornerAndEntrance[corner.index][entrance];
        const mask = layouts[(identity.identity + corner.index) % layouts.length];
        const player = makeTestPlayer(`selected_${identity.name}_${corner.name}`);
        const generation = generationSeed++;
        setRun(player, identity.identity, corner.index, entrance, mask, generation);
        approachSarcophagus(player, sarcRow);
        const beforeRun = snapshot(player);
        const beforePosition = position(player);
        const actorsBefore = activeNpcIds();
        player.messages.length = 0;
        player.packets.length = 0;

        const selected = measureRandom(() => {
          assertLayout(player, corner.index);
          const { state } = runLocAction(player, sarcLoc, `[oploc1,${identity.sarcName}]`);
          assertTunnelPrompt(player, state);
          assertLayout(player, corner.index);
          assertNoNewActors(actorsBefore, `${identity.name} selected Search`);
          resumeContinue(player, state);
          assert.equal(state.execution, ScriptState.FINISHED, 'the real Continue input resumes Search to completion');
          assert.equal(player.activeScript, null, 'natural tunnel entry releases the suspended Search script');
          assert.equal(player.delayed, false, 'natural tunnel entry leaves no action delay');
          assert.deepEqual(position(player), [0, corner.x, corner.z], `${identity.name} Search descends to ${corner.name} landing`);
          assert.deepEqual(snapshot(player), beforeRun, 'descent preserves identity, generation, layout, credit and countdowns');
          assertLayout(player, corner.index);
          assertNoNewActors(actorsBefore, `${identity.name} selected descent`);
        });
        assert.equal(selected.calls, 0, 'selected Search and descent consume no random draws');

        const beforeRelog = snapshot(player);
        const tunnelPosition = position(player);
        const relog = measureRandom(() => {
          runLifecycleTrigger(player, 'logout');
          runLifecycleTrigger(player, 'login');
        });
        assert.equal(relog.calls, 0, 'clean tunnel logout/login never redraws identity or layout');
        assert.deepEqual(snapshot(player), beforeRelog, 'clean tunnel logout/login preserves identity and every layout field');
        assert.deepEqual(position(player), tunnelPosition, 'clean tunnel logout/login keeps the player at the selected ladder');
        assertLayout(player, corner.index);
        assert.equal(player.overlay, Component.getId('kill_count'), 'tunnel login resumes the Barrows overlay');
        assertNoNewActors(actorsBefore, `${identity.name} clean relog`);

        for (const candidate of corners) {
          const trigger = chooseLocTrigger(player, ladderLocs.get(candidate.index));
          if (candidate.index === corner.index) {
            assert(trigger, `${corner.name} visible parent ladder dispatches`);
            assert.equal(trigger.name, '[oploc1,barrows_ladder]', `${corner.name} resolves through the real parent-ladder action`);
          } else {
            assert.notEqual(trigger?.name, '[oploc1,barrows_ladder]', `${candidate.name} inactive parent ladder does not dispatch`);
          }
        }
        assertLayout(player, corner.index);
        const beforeExit = snapshot(player);
        const exitActors = activeNpcIds();
        player.packets.length = 0;
        const climb = measureRandom(() => {
          const { state } = runLocAction(player, ladderLocs.get(corner.index), '[oploc1,barrows_ladder]');
          assert.equal(state.execution, ScriptState.FINISHED, `${corner.name} parent ladder exits synchronously`);
          assert.equal(player.activeScript, null, `${corner.name} ladder leaves no active script`);
          assert.equal(player.delayed, false, `${corner.name} ladder leaves no delay`);
          assert.deepEqual(position(player), entryPosition(identity.name), `${corner.name} ladder returns to ${identity.name}'s original enum destination`);
          assert.deepEqual(snapshot(player), beforeExit, 'tunnel exit cleanup and resume preserve the unfinished run and topology');
          assert.equal(player.overlay, Component.getId('kill_count'), 'crypt arrival resumes the Barrows overlay');
          assert.equal(player.modalMain, -1, 'tunnel exit cleanup leaves no main modal');
          assert.equal(player.modalChat, -1, 'tunnel exit cleanup leaves no chat modal');
          assert(player.packets.some(packet => packet.constructor.name === 'CamReset'), 'tunnel exit runs the normal camera cleanup');
          assertNoNewActors(exitActors, `${corner.name} ladder exit`);
        });
        assert.equal(climb.calls, 0, 'ladder exit consumes no random draws');
        assertLayout(player, corner.index);
      }
    }

    // A closed Continue modal cancels the suspended Search without resuming it.
    {
      const identity = identities[0];
      const corner = corners[0];
      const entrance = 0;
      const mask = masksByCornerAndEntrance[corner.index][entrance][0];
      const player = makeTestPlayer('closed_prompt');
      setRun(player, identity.identity, corner.index, entrance, mask, generationSeed++);
      approachSarcophagus(player, sarcRows.get(identity.sarcName));
      const beforeRun = snapshot(player);
      const beforePosition = position(player);
      const actorsBefore = activeNpcIds();
      player.messages.length = 0;
      player.packets.length = 0;
      const cancelled = measureRandom(() => {
        const { state } = runLocAction(player, sarcLocs.get(identity.sarcName), `[oploc1,${identity.sarcName}]`);
        assertTunnelPrompt(player, state);
        assertLayout(player, corner.index);
        player.closeModal();
        assert.equal(player.activeScript, null, 'closing the modal cancels the suspended Search');
        assert.equal(player.modalChat, -1, 'closing the modal removes the Continue interface');
      });
      assert.equal(cancelled.calls, 0, 'closing the prompt consumes no random draws');
      assert.deepEqual(position(player), beforePosition, 'closing the prompt does not teleport');
      assert.deepEqual(snapshot(player), beforeRun, 'closing the prompt changes no identity, phase, layout, credit or countdown');
      assert.equal(player.getVar(ids.credit) >>> 0, 0, 'closing the prompt grants no credit');
      assertNoNewActors(actorsBefore, 'closed selected Search');
    }

    // The suspended script must retain its original generation, identity and origin.
    const staleResumeCases = [
      { name: 'generation', mutate: (player, identity, generation) => player.setVar(ids.generation, generation + 1) },
      { name: 'phase', mutate: player => writePhase(player, 0) },
      { name: 'identity', mutate: (player, identity) => writeIdentity(player, identities.find(row => row.identity !== identity).identity) },
      { name: 'origin', mutate: player => { player.x++; } }
    ];
    for (const [index, stale] of staleResumeCases.entries()) {
      const identity = identities[index % identities.length];
      const corner = corners[index % corners.length];
      const entrance = (identity.identity + corner.index) % 4;
      const mask = masksByCornerAndEntrance[corner.index][entrance][0];
      const generation = generationSeed++;
      const player = makeTestPlayer(`stale_resume_${stale.name}`);
      setRun(player, identity.identity, corner.index, entrance, mask, generation);
      approachSarcophagus(player, sarcRows.get(identity.sarcName));
      const actorsBefore = activeNpcIds();
      player.messages.length = 0;
      player.packets.length = 0;
      const measured = measureRandom(() => {
        const { state } = runLocAction(player, sarcLocs.get(identity.sarcName), `[oploc1,${identity.sarcName}]`);
        assertTunnelPrompt(player, state);
        assertLayout(player, corner.index);
        stale.mutate(player, identity.identity, generation);
        const staleState = snapshot(player);
        const stalePosition = position(player);
        resumeContinue(player, state);
        assert.equal(state.execution, ScriptState.FINISHED, `${stale.name} stale continuation finishes without descent`);
        assert.equal(player.activeScript, null, `${stale.name} stale continuation releases its script`);
        assert.deepEqual(snapshot(player), staleState, `${stale.name} stale continuation writes no run state`);
        assert.deepEqual(position(player), stalePosition, `${stale.name} stale captured payload does not descend`);
        assert.notDeepEqual(position(player), [0, corner.x, corner.z], `${stale.name} stale payload does not reach the ladder`);
        assertNoNewActors(actorsBefore, `${stale.name} stale selected Search`);
      });
      assert.equal(measured.calls, 0, `${stale.name} stale continuation consumes no random draws`);
    }

    // Call the packed transition directly for every corner, independent of Search.
    for (const corner of corners) {
      const identity = identities[corner.index % identities.length];
      const entrance = (identity.identity + corner.index) % 4;
      const mask = masksByCornerAndEntrance[corner.index][entrance][0];
      const generation = generationSeed++;
      const player = makeTestPlayer(`direct_enter_${corner.name}`);
      setRun(player, identity.identity, corner.index, entrance, mask, generation);
      approachSarcophagus(player, sarcRows.get(identity.sarcName));
      const origin = CoordGrid.packCoord(player.level, player.x, player.z);
      const beforeRun = snapshot(player);
      const actorsBefore = activeNpcIds();
      assertLayout(player, corner.index);
      const measured = measureRandom(() => procInt(player, 'barrows_tunnel_enter', [generation, identity.identity, origin]));
      assert.equal(measured.value, 1, `${corner.name} direct packed tunnel_enter accepts a current captured payload`);
      assert.equal(measured.calls, 0, `${corner.name} direct tunnel_enter consumes no random draws`);
      assert.deepEqual(position(player), [0, corner.x, corner.z], `${corner.name} direct packed entry uses its selected landing`);
      assert.deepEqual(snapshot(player), beforeRun, `${corner.name} direct entry preserves identity, layout and credit`);
      assertLayout(player, corner.index);
      assertNoNewActors(actorsBefore, `${corner.name} direct entry`);
    }

    const directGuardCases = [
      { name: 'generation', arguments: (generation, identity, origin) => [generation + 1, identity, origin] },
      { name: 'phase', prepare: player => writePhase(player, 0), arguments: (generation, identity, origin) => [generation, identity, origin] },
      { name: 'identity', arguments: (generation, identity, origin) => [generation, identities.find(row => row.identity !== identity).identity, origin] },
      { name: 'origin', prepare: player => { player.x++; }, arguments: (generation, identity, origin) => [generation, identity, origin] }
    ];
    for (const [index, stale] of directGuardCases.entries()) {
      const identity = identities[index % identities.length];
      const corner = corners[index % corners.length];
      const entrance = (identity.identity + corner.index) % 4;
      const mask = masksByCornerAndEntrance[corner.index][entrance][0];
      const generation = generationSeed++;
      const player = makeTestPlayer(`direct_stale_${stale.name}`);
      setRun(player, identity.identity, corner.index, entrance, mask, generation);
      approachSarcophagus(player, sarcRows.get(identity.sarcName));
      const origin = CoordGrid.packCoord(player.level, player.x, player.z);
      assertLayout(player, corner.index);
      stale.prepare?.(player);
      const beforeRun = snapshot(player);
      const beforePosition = position(player);
      const actorsBefore = activeNpcIds();
      const measured = measureRandom(() => procInt(player, 'barrows_tunnel_enter', stale.arguments(generation, identity.identity, origin)));
      assert.equal(measured.value, 0, `${stale.name} direct packed tunnel_enter rejects stale state`);
      assert.equal(measured.calls, 0, `${stale.name} stale direct entry consumes no random draws`);
      assert.deepEqual(snapshot(player), beforeRun, `${stale.name} stale direct entry writes no run state`);
      assert.deepEqual(position(player), beforePosition, `${stale.name} stale direct entry does not teleport`);
      assertNoNewActors(actorsBefore, `${stale.name} stale direct entry`);
    }

    // Exercise every original sarcophagus action as a nonselected resident control.
    for (const [index, name] of brothers.entries()) {
      const sarcName = `barrow_${name}_sarcophagus`;
      const residentName = sarcJoin.get(sarcName).replace('barrows_', '');
      const residentIdentity = identities.find(row => row.name === residentName).identity;
      const tunnelIdentity = identities[(index + 1) % identities.length];
      assert.notEqual(tunnelIdentity.identity, residentIdentity, `${name} resident control is not the selected tunnel crypt`);
      const corner = corners[index % corners.length];
      const entrance = (tunnelIdentity.identity + corner.index) % 4;
      const mask = masksByCornerAndEntrance[corner.index][entrance][0];
      const generation = generationSeed++;
      const player = makeTestPlayer(`resident_${name}`);
      setRun(player, tunnelIdentity.identity, corner.index, entrance, mask, generation);
      approachSarcophagus(player, sarcRows.get(sarcName));
      const beforeRun = snapshot(player);
      const beforePosition = position(player);
      const actorsBefore = activeNpcIds();
      const { state } = runLocAction(player, sarcLocs.get(sarcName), `[oploc1,${sarcName}]`);
      assert.equal(state.execution, ScriptState.FINISHED, `${name} nonselected Search completes synchronously`);
      assert.equal(player.activeScript, null, `${name} nonselected Search leaves no suspended script`);
      assert.equal(player.delayed, false, `${name} nonselected Search leaves no delay`);
      assert.deepEqual(position(player), beforePosition, `${name} nonselected Search stays in its crypt`);
      assert.deepEqual(snapshot(player), beforeRun, `${name} nonselected Search grants no credit or run mutation`);
      const spawned = newActiveNpcs(actorsBefore);
      assert.equal(spawned.length, 1, `${name} nonselected Search summons exactly one resident`);
      const actor = spawned[0];
      assert.equal(actor.type, identities.find(row => row.name === name).npcId, `${name} sarcophagus join summons its mapped resident`);
      assert.equal(actor.getVar(owners.uid), player.uid, `${name} resident belongs to the searching player`);
      assert.equal(actor.getVar(owners.generation), generation, `${name} resident captures the current run generation`);
      assert.equal(actor.level, 3, `${name} resident stays in the crypt`);
      assert.equal(player.getVar(ids.credit) >>> 0, 0, `${name} resident summon grants no credit`);
      for (const npc of spawned) World.removeNpc(npc, -1);
    }

    console.log('PASS S05 packed selected Search, Continue resume, stale guards, four parent ladders, clean relog and six resident controls');
  } finally {
    for (const loc of clippedSarcs.reverse()) clipSarcophagus(loc, false);
    for (const npc of activeNpcs()) World.removeNpc(npc, -1);
    for (const player of players) {
      if (player.activeScript || player.modalMain !== -1 || player.modalChat !== -1) player.closeModal();
      delete World.players[player.slot];
    }
  }
});
