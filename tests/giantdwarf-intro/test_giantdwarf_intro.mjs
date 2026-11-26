/**
 * Real compiled GD timed-chat and save/load regressions. Run after a full pack:
 *   node --import tsx ../content/tests/giantdwarf-intro/test_giantdwarf_intro.mjs
 * No engine is started. Captured packets are not a live rendering proof.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const eng = rel => import(pathToFileURL(path.join(engine, 'src', rel)).href);
const { default: World } = await eng('engine/World.ts');
const { NetworkPlayer } = await eng('engine/entity/NetworkPlayer.ts');
const { CoordGrid } = await eng('engine/CoordGrid.ts');
const { allocateIfAbsent } = await eng('engine/routefinder/index.ts');
const { default: Npc } = await eng('engine/entity/Npc.ts');
const { EntityLifeCycle } = await eng('engine/entity/EntityLifeCycle.ts');
const { MoveRestrict } = await eng('engine/entity/MoveRestrict.ts');
const { NpcMode } = await eng('engine/entity/NpcMode.ts');
const { PlayerLoading } = await eng('engine/entity/PlayerLoading.ts');
const { default: Packet } = await eng('io/Packet.ts');
const { default: VarPlayerType } = await eng('cache/config/VarPlayerType.ts');
const { default: VarBitType } = await eng('cache/config/VarBitType.ts');
const { default: VarNpcType } = await eng('cache/config/VarNpcType.ts');
const { default: DbRowType } = await eng('cache/config/DbRowType.ts');
const { default: DbTableType } = await eng('cache/config/DbTableType.ts');
const { default: DbTableIndex } = await eng('cache/config/DbTableIndex.ts');
const { default: EnumType } = await eng('cache/config/EnumType.ts');
const { default: ObjType } = await eng('cache/config/ObjType.ts');
const { default: ParamType } = await eng('cache/config/ParamType.ts');
const { default: NpcType } = await eng('cache/config/NpcType.ts');
const { default: SeqType } = await eng('cache/config/SeqType.ts');
const { default: InvType } = await eng('cache/config/InvType.ts');
const { default: FontType } = await eng('cache/config/FontType.ts');
const { default: MesanimType } = await eng('cache/config/MesanimType.ts');
const { default: Component } = await eng('cache/config/Component.ts');
const { default: ScriptProvider } = await eng('engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('engine/script/ScriptState.ts');
const { ScriptOpcode } = await eng('engine/script/ScriptOpcode.ts');
const { default: IfButton } = await eng('network/game/client/model/IfButton.ts');
const { default: IfButtonHandler } = await eng('network/game/client/handler/IfButtonHandler.ts');

for (const type of [VarPlayerType, VarBitType, VarNpcType, NpcType, SeqType, InvType, FontType, MesanimType, Component, DbRowType, DbTableType, EnumType, ObjType, ParamType]) type.load(pack);
DbTableIndex.init();
const scriptCount = ScriptProvider.load(pack);
assert(scriptCount > 0, 'full compiled script pack is required');
World.currentTick = 1;
// Allocate only the scripted destination zones for transport-free teleport tests.
// This is not a full terrain/collision or walkability proof.
for (const [x, z, level] of [[2860, 10186, 1], [2856, 10194, 0], [2862, 10180, 0],
  [2889, 10225, 0], [2827, 10215, 0]]) allocateIfAbsent(x, z, level);

function id(kind, name) {
  const row = fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8')
    .split('\n').find(line => line.slice(line.indexOf('=') + 1) === name);
  assert(row, `missing ${kind} ${name}`);
  return Number(row.slice(0, row.indexOf('=')));
}

function player(saved = null) {
  // A transport-free fixture: use the real output phase but capture its messages.
  const p = saved ? PlayerLoading.load('gd_unit', new Packet(saved), null) :
    new NetworkPlayer('gd_unit', 0n, 0n, { uuid: 'offline-gd-fixture' });
  p.uid = 1;
  p.pid = 1;
  p.packets = [];
  p.write = message => {
    const row = { ...message, kind: message.constructor.name, tick: World.currentTick };
    if (row.kind === 'CamMoveTo' || row.kind === 'CamLookAt') {
      row.worldX = message.x + CoordGrid.zoneOrigin(p.originX);
      row.worldZ = message.z + CoordGrid.zoneOrigin(p.originZ);
    }
    p.packets.push(row);
  };
  return p;
}

// Audit every named GD bit, not just the stage and the first-visit flags.
const varbitText = fs.readFileSync(path.join(content, 'scripts/_unpack/377/all.varbit'), 'utf8');
const gdBits = [...varbitText.matchAll(/^\[(giantdwarf_[^\]]+)\]\nbasevar=([^\n]+)\nstartbit=(\d+)\nendbit=(\d+)/gm)];
assert.equal(gdBits.length, 14, 'the complete original GD bit family must be audited');
const p = player();
const bitValues = [];
for (const [, name, base, start, end] of gdBits) {
  assert.equal(base, 'giantdwarf_main');
  assert.equal(VarPlayerType.get(id('varp', base)).scope, VarPlayerType.SCOPE_PERM, `${name} base must persist`);
  const bit = id('varbit', name);
  const value = name === 'giantdwarf_quest' ? 2 : Math.min(3, 2 ** (Number(end) - Number(start) + 1) - 1);
  p.setVarBit(bit, value);
  bitValues.push([bit, name, value]);
}
const savedMain = p.vars[id('varp', 'giantdwarf_main')];
const loaded = PlayerLoading.load('gd_unit', new Packet(p.save()), null);
assert.equal(loaded.vars[id('varp', 'giantdwarf_main')], savedMain);
for (const [bit, name, value] of bitValues) assert.equal(loaded.getVarBit(bit), value, `${name} survives real save/load`);
console.log(`OK all ${gdBits.length} GD varbits share permanent varp 482 and survive Player.save/PlayerLoading.load`);

// Original no-Continue assets. Child positions distinguish NPC-left/player-right.
const npcInterfaces = ['inter_256', 'inter_257', 'inter_258', 'inter_227'];
const playerInterfaces = ['inter_245', 'inter_246', 'inter_247', 'inter_228'];
for (const name of [...npcInterfaces, ...playerInterfaces]) {
  const root = Component.get(id('interface', name));
  const children = [...root.childId].map(child => Component.get(child));
  assert.equal(children.length, 3 + (npcInterfaces.includes(name) ? npcInterfaces.indexOf(name) : playerInterfaces.indexOf(name)));
  assert(children.every(child => child.buttonType === Component.NO_BUTTON), `${name} has no Continue/button child`);
  assert(children.every(child => !child.text?.includes('Click here to continue')));
}
console.log('OK all eight original timed chat interfaces contain no Continue or pause button');

function timed(p, who, lines, delay = 5) {
  const npc = who !== 'Player';
  const name = npc ? 'giantdwarf_timed_npcchat' : 'giantdwarf_timed_playerchat';
  const script = ScriptProvider.getByName(`[proc,${name}]`);
  assert(script, `missing compiled ${name}`);
  const args = npc ? [who, id('npc', who === 'Black Guard Berserker' ? 'dwarf_city_berserker_cutscene' : 'dwarf_city_boatman_mines_prequest'), delay] : [delay];
  const state = ScriptRunner.init(script, p, null, args);
  state.splitPages = [lines];
  state.splitMesanim = MesanimType.getId('neutral');
  p.delayed = false;
  // Real call contract: no close between pages; previous roots remain populated.
  // The engine writes a close where the modal closes (no pending-close flag), so the
  // packet list itself shows whether a close happened.
  const firstMessage = p.packets.length;
  const result = p.runScript(state, true, true);
  assert.equal(result, ScriptState.SUSPENDED, 'timed chat delays, never p_pausebutton or ABORTED');
  assert.equal(p.delayedUntil, World.currentTick + 1 + delay);
  const messages = p.packets.slice(firstMessage);
  const open = messages.findIndex(message => message.kind === 'IfOpenChat');
  assert.equal(open, messages.length - 1, 'fully prepare text/head/animation before revealing the root');
  assert.equal(messages[open].component, id('interface', (npc ? npcInterfaces : playerInterfaces)[lines.length - 1]));
  assert(!messages.some(message => message.kind === 'IfClose'), 'do not unload a consecutive same-root page');
  const root = (npc ? npcInterfaces : playerInterfaces)[lines.length - 1];
  const texts = messages.filter(message => message.kind === 'IfSetText');
  assert.deepEqual(texts.map(message => [message.component, message.text]), [
    [id('interface', `${root}:com_1`), npc ? who : p.displayName],
    ...lines.map((text, i) => [id('interface', `${root}:com_${i + 2}`), text])
  ]);
  assert(messages.some(message => message.kind === (npc ? 'IfSetNpcHead' : 'IfSetPlayerHead')));
  assert(messages.some(message => message.kind === 'IfSetAnim'));
  assert(!messages.some(message => message.kind === 'IfSetHide'), 'do not hide unsupported text children');
  p.delayed = false;
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, 'resume without user input');
  assert.equal(p.modalChat, id('interface', root), 'leave the filled page open for its replacement');
  assert(!p.packets.slice(firstMessage).some(message => message.kind === 'IfClose'), 'no close while the filled page stays open');
  return messages;
}

for (const who of ['Dwarven Boatman', 'Player']) {
  for (let count = 1; count <= 4; count++) timed(player(), who, Array.from({ length: count }, (_, i) => `Timed line ${i + 1}`));
}
console.log('OK compiled NPC/player helpers: 1-4 lines, prepare-before-open, real delays and no inter-page close');

// Real crash/dock strings use the real SPLIT_INIT handler and original q8 metrics.
const dialogue = [
  ['Dwarven Boatman', "Look, there's the statue of King Alvis, guarding the entrance to Keldagrim!", 5],
  ['Player', "Amazing! And we're going to go straight past it?", 6],
  ['Dwarven Boatman', "That's right!", 2],
  ['Dwarven Boatman', "Er, hold on! There's something wrong!", 4],
  ['Black Guard Berserker', 'Halt! By order of the Black Guard, you are under arrest!', 8],
  ['Player', "What?? I didn't do anything! It wasn't me!", 8],
  ['Black Guard Berserker', 'Come with us, human! Commander Veldaban wants a word with you!', 8]
];
const actor = player();
for (const [who, text, delay] of dialogue) {
  const splitState = ScriptRunner.init(ScriptProvider.getByName('[proc,giantdwarf_timed_playerchat]'), actor);
  splitState.pushString(`<p,neutral>${text}`);
  splitState.pushInt(380);
  splitState.pushInt(4);
  splitState.pushInt(3);
  ScriptRunner.HANDLERS[ScriptOpcode.SPLIT_INIT](splitState);
  assert.equal(splitState.splitPages.length, 1);
  timed(actor, who, splitState.splitPages[0], delay);
}
console.log('OK all seven actual crash/dock lines split and populate the correct timed widgets, including consecutive one-line Boatman pages');

// Java 377 drains at most five packets per client cycle (Client.java:3030).
// Replay its chat open/unload rules at every possible split, using packed text.
// This checks protocol visibility boundaries, not pixels or a live renderer.
function assertNoVisibleDefaults(messages) {
  for (let offset = 0; offset < 5; offset++) {
    let chat = -1;
    const text = new Map();
    const heads = new Set();
    const animations = new Set();
    const unload = root => {
      if (root < 0) return;
      for (const child of Component.get(root).childId) {
        text.delete(child);
        heads.delete(child);
        animations.delete(child);
      }
    };
    const draw = () => {
      if (chat < 0) return;
      for (const child of Component.get(chat).childId) {
        const packed = Component.get(child);
        if (packed.comType === Component.TYPE_TEXT) {
          assert(!/^(?:Name|Line[1-4])$/.test(text.get(child) ?? packed.text),
            `visible defaults at root ${chat}, packet-cycle offset ${offset}`);
        } else if (packed.comType === Component.TYPE_MODEL) {
          assert(heads.has(child) && animations.has(child), `unprepared head at root ${chat}`);
        }
      }
    };
    for (const [index, message] of messages.entries()) {
      if (message.kind === 'IfClose') {
        unload(chat);
        chat = -1;
      } else if (message.kind === 'IfOpenChat') {
        if (chat !== message.component) unload(chat);
        chat = message.component;
      } else if (message.kind === 'IfSetText') {
        text.set(message.component, message.text);
      } else if (message.kind === 'IfSetNpcHead' || message.kind === 'IfSetPlayerHead') {
        heads.add(message.component);
      } else if (message.kind === 'IfSetAnim') {
        animations.add(message.component);
      }
      if ((index + offset + 1) % 5 === 0) draw();
    }
    draw();
  }
}
assertNoVisibleDefaults(actor.packets);
const beforeClose = actor.packets.length;
actor.closeModal();
assert.equal(actor.packets.slice(beforeClose).filter(message => message.kind === 'IfClose').length, 1, 'closeModal writes the close at the lifecycle boundary');
actor.encodeOut();
assert.equal(actor.packets.slice(beforeClose).filter(message => message.kind === 'IfClose').length, 1, 'the output phase adds no second close');
console.log('OK seven timed boxes have no visible defaults or missing heads at all five packet-cycle offsets');

// Exercise the actual compiled intro with NPC turns and end-of-tick resets.
// Give both original map identities an unfinished wander path at dock staging.
const guardId = id('npc', 'dwarf_city_berserker_cutscene_multi');
assert.equal(guardId, 2231);
const guardType = NpcType.get(guardId);
assert.equal(guardType.multinpc[1], id('npc', 'dwarf_city_berserker_cutscene'));
assert.equal(guardType.wanderrange, 5, 'shared guards retain their original wandering range');
assert.equal(guardType.moverestrict, MoveRestrict.NORMAL, 'no type-global cutscene freeze');
assert.equal(guardType.defaultmode, NpcMode.WANDER, 'shared guards retain their original default mode');
const guardRows = fs.readFileSync(path.join(content, 'maps/m45_159.jm2'), 'utf8')
  .split('\n').filter(line => /^0 10 (?:48|50): 2231$/.test(line));
assert.deepEqual(guardRows, ['0 10 48: 2231', '0 10 50: 2231']);
const guards = [10224, 10226].map((z, index) => {
  const npc = new Npc(0, 2890, z, 1, 1, EntityLifeCycle.RESPAWN, index + 1, guardId, guardType.blockwalk);
  World.addNpc(npc, -1);
  return npc;
});
function npcTurn() {
  // Pin only random wander selection, not movement, queues or collision.
  // A queued waypoint must still walk, including in NONE mode.
  const random = Math.random;
  Math.random = () => 0.999;
  try {
    for (const npc of guards) npc.turn();
  } finally {
    Math.random = random;
  }
}
function runIntro(equipment = [], interruptAtDock = false) {
  guards.forEach((npc, index) => {
    npc.teleJump(index === 0 ? 2895 : 2885, index === 0 ? 10224 : 10226, 0);
    npc.clearWaypoints(); // fixture setup only; the compiled staging must replace its own path
    npc.sayMessage = null;
    assert.equal(npc.targetOp, NpcMode.WANDER);
  });
  const trip = player();
  trip.positions = [];
  trip.tabs[10] = id('interface', 'logout'); // ordinary login tab remains during the scene
  for (const name of equipment) {
    const obj = ObjType.get(id('obj', name));
    trip.invSet(id('inv', 'worn'), obj.id, 1, obj.wearpos);
  }
  trip.setVarBit(id('varbit', 'giantdwarf_quest'), 1); // entry fixture, not a stage-write proof
  const intro = ScriptRunner.init(ScriptProvider.getByName('[proc,giantdwarf_intro_cutscene]'), trip);
  const guardHistory = [];
  let pendingWander = false;
  const walkedBeforeStaging = guards.map(() => false);
  let stagedTick = -1;
  let shoutTick = -1;
  let result = trip.runScript(intro, true, true);
  for (let turns = 0; result === ScriptState.SUSPENDED; turns++) {
    assert(turns < 100, 'cutscene must reach the real Veldaban prompt');
    if (interruptAtDock && guards.every(npc => npc.targetOp === NpcMode.NONE)) {
      assert(stagedTick >= 0, 'interruption follows the armed staging regression');
      return { trip, guardHistory, stagedTick };
    }
    // Reset in the same phase order as World: player writes, output/reset,
    // then the next tick's NPC turn before resuming the delayed player.
    trip.encodeOut();
    trip.updateMap();
    // Inspect output only after encodeOut has flushed this suspension's fade.
    // Before that flush the last overlay is still the map, not dock black.
    if (!pendingWander && trip.getVarBit(id('varbit', 'giantdwarf_cutscene_guard_visible')) === 0 &&
        trip.packets.some(message => message.kind === 'IfOpenChat' && message.component === id('interface', 'inter_274')) &&
        trip.packets.findLast(message => message.kind === 'IfOpenOverlay')?.component === id('interface', 'fade_to_black')) {
      assert.equal(stagedTick, -1, 'wander must be armed before dock staging, never at the HQ fade');
      assert(guards.every(npc => npc.targetOp === NpcMode.WANDER));
      guards.forEach((npc, index) => npc.queueWaypoint(index === 0 ? 2885 : 2895, npc.z));
      pendingWander = true;
    }
    const resumeTick = trip.delayedUntil;
    while (World.currentTick < resumeTick) {
      for (const npc of guards) npc.resetEntity(false);
      World.currentTick++;
      const before = guards.map(npc => [npc.x, npc.z]);
      npcTurn();
      if (pendingWander && stagedTick < 0) {
        guards.forEach((npc, index) => {
          walkedBeforeStaging[index] ||= npc.x !== before[index][0] || npc.z !== before[index][1];
        });
      }
      guardHistory.push({ tick: World.currentTick, guards: guards.map(npc => [npc.x, npc.z, npc.targetOp]) });
      if (stagedTick >= 0 && guards.some(npc => npc.targetOp === NpcMode.NONE)) {
        assert.deepEqual(guards.map(npc => [npc.x, npc.z]).sort((a, b) => a[1] - b[1]), [[2890, 10224], [2890, 10226]],
          `held guards must not follow their old wander waypoints after staging, tick ${World.currentTick}`);
      }
    }
    trip.delayed = false;
    const staging = pendingWander && stagedTick < 0;
    if (staging) {
      assert(guards.every(npc => npc.targetOp === NpcMode.WANDER), 'both actors still wander before staging');
      assert(walkedBeforeStaging.every(Boolean), 'both actors walk before staging');
      assert(guards.every(npc => npc.waypointIndex >= 0 &&
        npc.waypoints[npc.waypointIndex] !== CoordGrid.packCoord(0, npc.x, npc.z)),
      'both actors have an unfinished wander waypoint immediately before compiled staging');
      console.log(`OK armed wander immediately before staging at tick ${World.currentTick}: ${JSON.stringify(guards.map(npc =>
        ({ x: npc.x, z: npc.z, waypoint: CoordGrid.unpackCoord(npc.waypoints[npc.waypointIndex]) })))}`);
    }
    result = trip.runScript(intro, true, true);
    trip.positions.push({ tick: World.currentTick, x: trip.x, z: trip.z, level: trip.level });
    if (staging) {
      assert(guards.every(npc => npc.targetOp === NpcMode.NONE), 'this resume must execute compiled dock staging');
      stagedTick = World.currentTick;
      assert.deepEqual(guards.map(npc => [npc.x, npc.z]).sort((a, b) => a[1] - b[1]), [[2890, 10224], [2890, 10226]]);
    }
    if (guards.some(npc => npc.sayMessage === 'Halt!')) shoutTick = World.currentTick;
  }
  trip.encodeOut();
  trip.updateMap();
  assert.equal(result, ScriptState.PAUSEBUTTON, 'compiled intro reaches interactive Veldaban');
  assert(pendingWander, 'the staging regression supplies an unfinished wander waypoint');
  assert(walkedBeforeStaging.every(Boolean), 'real NPC movement consumes both unfinished wander paths before staging');
  assert(stagedTick >= 0, 'compiled staging must follow the armed wander');
  assert(shoutTick >= 0, 'real base lookup sends overhead speech before reset clears it');
  assert(guards.every(npc => npc.targetOp === NpcMode.WANDER), 'both shared actors resume normal movement');
  const arrest = trip.packets.find(message => message.kind === 'IfSetText' && message.text === 'Black Guard Berserker');
  assert(arrest);
  assert.equal(shoutTick, arrest.tick - 3, 'actual overhead speech precedes the arrest page by three intervals');
  const shout = guardHistory.find(row => row.tick === shoutTick);
  assert(shout, 'record actual queue state at the overhead shout');
  assert.deepEqual(shout.guards.map(([x, z]) => [x, z]).sort((a, b) => a[1] - b[1]), [[2890, 10224], [2890, 10226]]);
  assert(shout.guards.every(([, , mode]) => mode === NpcMode.NONE), 'posts hold during Halt');
  const held = guardHistory.filter(row => row.tick > stagedTick && row.tick <= arrest.tick);
  assert.equal(held.length, arrest.tick - stagedTick, 'record every NPC turn from staging through the full shout hold');
  for (const row of held) {
    assert.deepEqual(row.guards.map(([x, z]) => [x, z]).sort((a, b) => a[1] - b[1]), [[2890, 10224], [2890, 10226]],
      `both guards stay at their posts through the shout, tick ${row.tick}`);
    assert(row.guards.every(([, , mode]) => mode === NpcMode.NONE), `both guards remain held at tick ${row.tick}`);
  }
  console.log(`OK both guard posts hold from staging ${stagedTick} through Halt ${shoutTick} and arrest ${arrest.tick}`);
  assert(guardHistory.find(row => row.tick === arrest.tick + 1).guards.every(([, , mode]) => mode === NpcMode.WANDER),
    'release is bounded to the shout, not the whole arrest');
  return { trip, guardHistory };
}
const equipment = ['rune_med_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'rune_scimitar'];
const { trip } = runIntro(equipment);
assertNoVisibleDefaults(trip.packets);
const mapOpen = trip.packets.find(message => message.kind === 'IfOpenOverlay' && message.component === id('interface', 'inter_234'));
const both = trip.packets.find(message => message.kind === 'IfOpenChat' && message.component === id('interface', 'inter_274'));
assert(mapOpen && both);
assert.equal(both.tick - mapOpen.tick, 24, 'Both opens 14.4 s after map open at the canonical 600 ms tick');
const approachPages = trip.packets.filter(message => message.kind === 'IfOpenChat' && message.tick >= mapOpen.tick && message.tick <= both.tick);
assert.equal(approachPages.length, 5, 'four approach pages followed by Both');
assert.equal(approachPages[0].tick - mapOpen.tick, 1, 'one 600 ms map lead-in interval');
assert.deepEqual(approachPages.slice(1).map((message, index) => message.tick - approachPages[index].tick),
  [7, 7, 4, 5], '10-fps footage measurements map to the real compiled page suspensions');
const firstFade = trip.packets.find(message => message.kind === 'IfOpenOverlay' && message.component === id('interface', 'fade_to_black'));
const firstTitle = trip.packets.find(message => message.kind === 'IfOpenOverlay' && message.component === id('interface', 'inter_273'));
console.log(`OK compiled cutscene intervals to Veldaban prompt: initial close ${World.currentTick - trip.packets[0].tick}, first fade ${World.currentTick - firstFade.tick}, first title ${World.currentTick - firstTitle.tick}; title-to-map ${mapOpen.tick - firstTitle.tick}`);
assert.equal(World.currentTick - firstFade.tick, 141, 'candidate first-fade-to-prompt schedule is 84.6s versus footage 84.3s');
assert.equal(firstTitle.tick - firstFade.tick, 10, 'first title follows first fade by 6.0s, not fade-in by 1.8s');
assert.equal(mapOpen.tick - firstTitle.tick, 58, 'measured first-title-to-map span is 34.8s');
const fadePackets = trip.packets.filter(message => message.kind === 'IfOpenOverlay' &&
  message.component === id('interface', 'fade_to_black'));
assert.equal(fadePackets.length, 3);
for (const [index, [x, z, level]] of [[2860, 10186, 1], [2889, 10225, 0], [2827, 10215, 0]].entries()) {
  const arrival = trip.positions.find(position => position.x === x && position.z === z && position.level === level);
  assert(arrival, `compiled teleport ${index} reaches its actual destination`);
  assert.equal(arrival.tick - fadePackets[index].tick, 3,
    `teleport ${index} waits 1.8s, beyond the observed 1.34–1.44s client fade`);
}
assert(!trip.packets.some(message => message.text === 'Invalid teleport!'));
console.log('OK all three real teleport destinations follow fade start by three 600ms intervals; opening and total durations unchanged');
const titleLayers = [10, 11, 12].map(n => trip.packets.find(message =>
  message.kind === 'IfSetHide' && message.component === id('interface', `inter_273:com_${n}`) && !message.hidden));
for (const [index, layer] of titleLayers.entries()) {
  assert(layer);
  const close = trip.packets.find(message => message.kind === 'IfSetHide' &&
    message.component === layer.component && message.tick > layer.tick && message.hidden);
  assert(close);
  assert.equal(close.tick - layer.tick, [4, 4, 15][index], 'source-supported title-window intervals');
}
const historyRoot = trip.packets.find(message => message.kind === 'IfOpenOverlay' && message.component === id('interface', 'inter_235'));
const historyComponents = new Set(Array.from({ length: 9 }, (_, n) => id('interface', `inter_235:com_${n}`)));
const historyTicks = [...new Set(trip.packets.filter(message => message.kind === 'IfSetHide' &&
  historyComponents.has(message.component)).map(message => message.tick - historyRoot.tick))];
assert.deepEqual(historyTicks, [0, 1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 16, 17, 18],
  'history reveals follow quantized retained transition times, without accumulated rounding');
const canal = trip.packets.find(message => message.kind === 'CamMoveTo' && message.height === 440);
const statue = trip.packets.find(message => message.kind === 'CamMoveTo' && message.height === 1340);
assert(canal && statue, 'candidate canal and explicit full-stack product camera are sent');
const lookAt = move => trip.packets.find(message => message.kind === 'CamLookAt' && message.tick === move.tick);
assert.deepEqual([canal.worldX, canal.worldZ, lookAt(canal).worldX, lookAt(canal).worldZ, lookAt(canal).height], [2880, 10188, 2880, 10196, 0]);
assert.deepEqual([statue.worldX, statue.worldZ, lookAt(statue).worldX, lookAt(statue).worldZ, lookAt(statue).height], [2874, 10168, 2880, 10179, 120]);
const miniatureMessages = trip.packets.filter(message => message.kind === 'IfSetAnim' && message.component === id('interface', 'inter_234:com_3'));
assert.deepEqual(miniatureMessages.map(message => message.seq), [-1, id('seq', 'mini_statue_explodes')]);
assert(miniatureMessages.every(message => message.tick === mapOpen.tick), 'initialize before map reveal; never restart/rewind at Both');
const original = SeqType.get(id('seq', 'mini_statue_explodes'));
assert.equal(original.frameCount, 78);
assert.equal(original.delay[0], 275);
assert.equal(original.delay[77], 20001);
function nativeFrameAt(cycles) {
  let frame = 0;
  while (cycles > original.delay[frame]) {
    cycles -= original.delay[frame++];
    assert(frame < original.frameCount, 'test window must not leave the original sequence');
  }
  return frame;
}
const bothCycles = (both.tick - mapOpen.tick) * 30; // 600 ms / 20 ms native client cycle
assert(nativeFrameAt(bothCycles + 5) < 69, 'even a full packet-cycle skew leaves Both before the live-recorded impact region');
assert.equal(nativeFrameAt(bothCycles + 9 * 30), 77, 'native collapse reaches rubble during the unchanged Both hold');
console.log(`OK full compiled intro: real guard Halt, 24-tick map-to-Both, native frame ${nativeFrameAt(bothCycles)} at Both and frame77 before its close`);
const bonusSpecs = [
  ['stabattack', 'Stab'], ['slashattack', 'Slash'], ['crushattack', 'Crush'], ['magicattack', 'Magic'], ['rangeattack', 'Range'],
  ['stabdefence', 'Stab'], ['slashdefence', 'Slash'], ['crushdefence', 'Crush'], ['magicdefence', 'Magic'], ['rangedefence', 'Range'],
  ['strengthbonus', 'Strength'], ['prayerbonus', 'Prayer']
];
function assertRestoredBonuses(trip, items) {
  const reopen = trip.packets.findLastIndex(message => message.kind === 'IfSetTab' && message.component === id('interface', 'wornitems'));
  assert(reopen >= 0);
  for (const [key, label] of bonusSpecs) {
    const param = id('param', key);
    const expected = items.reduce((sum, name) => sum + (ObjType.get(id('obj', name)).params.get(param) ?? ParamType.get(param).defaultInt), 0);
    const text = trip.packets.slice(reopen + 1).find(message => message.kind === 'IfSetText' &&
      message.component === id('interface', `wornitems:${key}`));
    assert.equal(text?.text, `${label}: ${expected >= 0 ? '+' : ''}${expected}`, 'refresh bonuses after wornitems reopens');
  }
}
assertRestoredBonuses(trip, equipment);

// D1: abandon the actual first briefing, save/load, then Talk-to the map type.
// No quest repair writes and no direct briefing-proc call after the save.
const veldabanId = id('npc', 'dwarf_city_black_guard_leader');
const veldaban = new Npc(0, 2826, 10215, 1, 1, EntityLifeCycle.RESPAWN, 3, veldabanId, NpcType.get(veldabanId).blockwalk);
World.addNpc(veldaban, -1);
function talkVeldaban(p) {
  const script = ScriptProvider.getByName('[opnpc1,dwarf_city_black_guard_leader]');
  const state = ScriptRunner.init(script, p, veldaban);
  const result = p.runScript(state, true, true);
  assert.equal(result, ScriptState.PAUSEBUTTON);
  return state;
}
function finishBriefing(p, state, accept) {
  for (let pauses = 0; pauses < 40; pauses++) {
    if (p.modalChat === id('interface', 'multi2')) {
      p.lastCom = id('interface', `multi2:com_${accept ? 1 : 2}`);
    }
    const result = p.runScript(state, true, true);
    if (result === ScriptState.FINISHED) return;
    assert.equal(result, ScriptState.PAUSEBUTTON, 'briefing only waits for normal dialogue input');
  }
  assert.fail('briefing must finish within its known dialogue length');
}
const recovered = player(trip.save());
assert.deepEqual([trip.x, trip.z, trip.level], [2827, 10215, 0], 'compiled first prompt is at HQ before save');
assert.equal(recovered.getVarBit(id('varbit', 'giantdwarf_quest')), 1);
assert.equal(recovered.getVarBit(id('varbit', 'giantdwarf_veldaban_introduced')), 0);
assert.equal(recovered.getVarBit(id('varbit', 'giantdwarf_statue_invis')), 1);
assert.deepEqual([recovered.x, recovered.z, recovered.level], [2827, 10215, 0]);
let briefing = talkVeldaban(recovered);
assert(recovered.packets.some(message => message.text === 'Identify yourself, human!'),
  'saved interrupted first visit must reach GD briefing, not Forget');
finishBriefing(recovered, briefing, false);
assert.equal(recovered.getVarBit(id('varbit', 'giantdwarf_quest')), 1, 'refusal keeps briefing recoverable');
assert.equal(recovered.getVarBit(id('varbit', 'giantdwarf_veldaban_introduced')), 0);
// Re-save after refusal and interrupt the next briefing at its first prompt.
const refused = player(recovered.save());
talkVeldaban(refused);
const retry = player(refused.save());
briefing = talkVeldaban(retry);
finishBriefing(retry, briefing, true);
assert.equal(retry.getVarBit(id('varbit', 'giantdwarf_quest')), 2, 'real recovery dialogue writes progress');
assert.equal(retry.getVarBit(id('varbit', 'giantdwarf_veldaban_introduced')), 1);
assert.equal(retry.getVarBit(id('varbit', 'forget_quest')), 0, 'GD recovery never starts Forget');
assert(!retry.packets.some(message => message.kind === 'CamMoveTo' || message.kind === 'CamLookAt' ||
  message.kind === 'IfOpenOverlay'), 'HQ recovery does not replay voyage or crash');
const completed = player(retry.save());
assert.equal(completed.getVarBit(id('varbit', 'giantdwarf_quest')), 2);
assert.equal(completed.getVarBit(id('varbit', 'giantdwarf_veldaban_introduced')), 1);
for (const [stage, introduced] of [[0, 0], [1, 1], [50, 1]]) {
  const other = player();
  other.setVarBit(id('varbit', 'giantdwarf_quest'), stage);
  other.setVarBit(id('varbit', 'giantdwarf_veldaban_introduced'), introduced);
  talkVeldaban(other);
  assert(other.packets.some(message => message.text?.includes('Have you heard?')),
    `existing Forget dispatch outside unfinished GD state ${stage}/${introduced} is unchanged`);
}
const inProgress = player();
inProgress.setVarBit(id('varbit', 'giantdwarf_quest'), 2);
inProgress.setVarBit(id('varbit', 'giantdwarf_veldaban_introduced'), 1);
inProgress.setVarBit(id('varbit', 'forget_quest'), 1);
const reminder = talkVeldaban(inProgress);
assert(inProgress.packets.some(message => message.text?.startsWith('How are you getting on with rebuilding our statue,')),
  'accepted Giant Dwarf work gets its in-progress reminder');
finishBriefing(inProgress, reminder, true);
assert.equal(inProgress.getVarBit(id('varbit', 'giantdwarf_quest')), 2, 'the reminder preserves Giant Dwarf progress');
assert.equal(inProgress.getVarBit(id('varbit', 'forget_quest')), 1, 'the reminder preserves concurrent Forgettable Tale progress');
console.log('OK saved HQ recovery; the stage-two reminder preserves both quests, and inactive/completed Giant Dwarf keeps Forget dispatch');
const { trip: emptyTrip } = runIntro();
assertRestoredBonuses(emptyTrip, []);
const interrupted = runIntro([], true);
assert(guards.every(npc => npc.targetOp === NpcMode.NONE));
const logoutButton = id('interface', 'logout:try_logout');
assert(interrupted.trip.isComponentVisible(Component.get(logoutButton)), 'logout tab is still visible');
const packetCount = interrupted.trip.packets.length;
assert.equal(new IfButtonHandler().handle(new IfButton(logoutButton), interrupted.trip), true,
  'visible logout request reaches the ordinary input handler');
assert.equal(interrupted.trip.loggingOut, false, 'delayed protected cutscene does not execute logout');
assert.equal(interrupted.trip.packets.length, packetCount, 'blocked logout emits no UI close or message');
assert.equal(interrupted.trip.delayed, true, 'blocked logout does not cancel the cutscene');
console.log('OK visible logout button is accepted as input but cannot obtain protected access during dock delay (product behavior only)');
for (let tick = 0; tick < 7; tick++) {
  World.currentTick++;
  for (const npc of guards) npc.resetEntity(false);
  npcTurn();
  if (tick < 6) {
    assert.deepEqual(guards.map(npc => [npc.x, npc.z]).sort((a, b) => a[1] - b[1]), [[2890, 10224], [2890, 10226]],
      'abandoned player does not release the hold early or leave an old wander destination');
  }
}
assert(guards.every(npc => npc.targetOp === NpcMode.WANDER), 'NPC-owned release survives an abandoned player script');
assert.equal(interrupted.trip.delayed, true, 'do not resume the interrupted player to restore guards');
console.log('OK unfinished-wander guards hold through real NPC movement and release after player interruption; equipped and empty bonus texts restore');
console.log(`PASS Giant Dwarf compiled intro regressions (${scriptCount} scripts loaded; no live renderer)`);
process.exit(0);
