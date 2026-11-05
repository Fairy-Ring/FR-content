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

for (const type of [VarPlayerType, VarBitType, VarNpcType, NpcType, SeqType, InvType, FontType, MesanimType, Component, DbRowType, DbTableType, EnumType, ObjType, ParamType]) type.load(pack);
DbTableIndex.init();
const scriptCount = ScriptProvider.load(pack);
assert(scriptCount > 0, 'full compiled script pack is required');
World.currentTick = 1;

function id(kind, name) {
  const row = fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8')
    .split('\n').find(line => line.slice(line.indexOf('=') + 1) === name);
  assert(row, `missing ${kind} ${name}`);
  return Number(row.slice(0, row.indexOf('=')));
}

function player() {
  // A transport-free fixture: use the real output phase but capture its messages.
  const p = new NetworkPlayer('gd_unit', 0n, 0n, { uuid: 'offline-gd-fixture' });
  p.uid = 1;
  p.pid = 1;
  p.packets = [];
  p.write = message => p.packets.push({ ...message, kind: message.constructor.name, tick: World.currentTick });
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
  // Phase-boundary closes are flushed by encodeOut during an earlier delay.
  assert.equal(p.refreshModalClose, false);
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
  assert.equal(p.refreshModalClose, false);
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
actor.closeModal();
actor.encodeOut();
assert.equal(actor.packets.at(-1).kind, 'IfClose', 'real output phase flushes the phase-boundary close');
assert.equal(actor.refreshModalClose, false);
console.log('OK seven timed boxes have no visible defaults or missing heads at all five packet-cycle offsets');

// Exercise the actual compiled intro, including every delay and both phase closes.
// The only NPC fixtures use the two unchanged packed map-spawn identities/tiles.
const guardId = id('npc', 'dwarf_city_berserker_cutscene_multi');
assert.equal(guardId, 2231);
const guardType = NpcType.get(guardId);
assert.equal(guardType.multinpc[1], id('npc', 'dwarf_city_berserker_cutscene'));
assert.equal(guardType.wanderrange, 0);
assert.equal(guardType.moverestrict, MoveRestrict.NOMOVE);
assert.equal(guardType.defaultmode, NpcMode.NONE);
const guardRows = fs.readFileSync(path.join(content, 'maps/m45_159.jm2'), 'utf8')
  .split('\n').filter(line => /^0 10 (?:48|50): 2231$/.test(line));
assert.deepEqual(guardRows, ['0 10 48: 2231', '0 10 50: 2231']);
const guards = [10224, 10226].map((z, index) => {
  const npc = new Npc(0, 2890, z, 1, 1, EntityLifeCycle.RESPAWN, index + 1, guardId, guardType.blockwalk);
  World.addNpc(npc, -1);
  assert.equal(npc.updateMovement(), false, 'the packed base refuses movement');
  return npc;
});
const trip = player();
trip.setVarBit(id('varbit', 'giantdwarf_quest'), 1); // intro-entry fixture, not a stage-write proof
const intro = ScriptRunner.init(ScriptProvider.getByName('[proc,giantdwarf_intro_cutscene]'), trip);
let result = trip.runScript(intro, true, true);
for (let turns = 0; result === ScriptState.SUSPENDED; turns++) {
  assert(turns < 100, 'cutscene must reach the real Veldaban prompt');
  trip.encodeOut();
  const resumeTick = trip.delayedUntil;
  while (World.currentTick < resumeTick) {
    World.currentTick++;
    for (const npc of guards) npc.turn();
  }
  trip.delayed = false;
  result = trip.runScript(intro, true, true);
}
trip.encodeOut();
assert.equal(result, ScriptState.PAUSEBUTTON, 'full compiled intro reaches the interactive Veldaban briefing');
assert(guards.some(npc => npc.sayMessage === 'Halt!'), 'real npc_find selects the spawned base and sends overhead speech');
assert.deepEqual(guards.map(npc => [npc.x, npc.z]), [[2890, 10224], [2890, 10226]], 'real NPC turns retain both map posts through the trip');
assertNoVisibleDefaults(trip.packets);
const mapOpen = trip.packets.find(message => message.kind === 'IfOpenOverlay' && message.component === id('interface', 'inter_234'));
const both = trip.packets.find(message => message.kind === 'IfOpenChat' && message.component === id('interface', 'inter_274'));
assert(mapOpen && both);
assert.equal(both.tick - mapOpen.tick, 24, 'Both opens 14.4 s after map open at the canonical 600 ms tick');
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
console.log(`PASS Giant Dwarf compiled intro regressions (${scriptCount} scripts loaded; no live renderer)`);
process.exit(0);
