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
const { default: Player } = await eng('engine/entity/Player.ts');
const { PlayerLoading } = await eng('engine/entity/PlayerLoading.ts');
const { default: Packet } = await eng('io/Packet.ts');
const { default: VarPlayerType } = await eng('cache/config/VarPlayerType.ts');
const { default: VarBitType } = await eng('cache/config/VarBitType.ts');
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

for (const type of [VarPlayerType, VarBitType, NpcType, SeqType, InvType, FontType, MesanimType, Component]) type.load(pack);
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
  const p = new Player('gd_unit', 0n, 0n);
  p.uid = 1;
  p.packets = [];
  p.write = message => p.packets.push(message);
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
  // Match the real call site: close a real previous chat, leaving IF_CLOSE pending.
  p.openChatModal(id('interface', 'inter_256'));
  p.closeModal();
  p.packets.length = 0;
  const result = p.runScript(state, true, true);
  assert.equal(result, ScriptState.SUSPENDED, 'timed chat delays, never p_pausebutton or ABORTED');
  assert.equal(p.delayedUntil, World.currentTick + 1 + delay);
  const messages = p.packets;
  const open = messages.findIndex(message => message.constructor.name === 'IfOpenChat');
  assert(open >= 0);
  assert.equal(messages[0].constructor.name, 'IfClose', 'pending close must precede content writes');
  assert.equal(messages[open].component, id('interface', (npc ? npcInterfaces : playerInterfaces)[lines.length - 1]));
  assert(messages.slice(0, open).every(message => message.constructor.name === 'IfClose'), 'no text/head/animation may precede open');
  const root = (npc ? npcInterfaces : playerInterfaces)[lines.length - 1];
  const texts = messages.filter(message => message.constructor.name === 'IfSetText');
  assert.deepEqual(texts.map(message => [message.component, message.text]), [
    [id('interface', `${root}:com_1`), npc ? who : p.displayName],
    ...lines.map((text, i) => [id('interface', `${root}:com_${i + 2}`), text])
  ]);
  assert(messages.some(message => message.constructor.name === (npc ? 'IfSetNpcHead' : 'IfSetPlayerHead')));
  assert(messages.some(message => message.constructor.name === 'IfSetAnim'));
  assert(!messages.some(message => message.constructor.name === 'IfSetHide'), 'do not hide unsupported text children');
  p.delayed = false;
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, 'resume closes timed chat without user input');
}

for (const who of ['Dwarven Boatman', 'Player']) {
  for (let count = 1; count <= 4; count++) timed(player(), who, Array.from({ length: count }, (_, i) => `Timed line ${i + 1}`));
}
console.log('OK compiled NPC/player helpers: 1-4 lines, open-before-content, real delays and automatic close');

// Real crash/dock strings use the real SPLIT_INIT handler and original q8 metrics.
const dialogue = [
  ['Dwarven Boatman', "Look, there's the statue of King Alvis, guarding the entrance to Keldagrim!", 7],
  ['Player', "Amazing! And we're going to go straight past it?", 8],
  ['Dwarven Boatman', "That's right!", 3],
  ['Dwarven Boatman', "Er, hold on! There's something wrong!", 5],
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
console.log('OK all seven actual crash/dock lines split and render to correct timed widgets, including consecutive one-line Boatman pages');
console.log(`PASS Giant Dwarf compiled intro regressions (${scriptCount} scripts loaded; no live renderer)`);
process.exit(0);
