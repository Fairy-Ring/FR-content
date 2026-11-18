// Packed conversations, production dispatch and Continue/choice packet handling.
// Run from the sibling built engine: node --import tsx ../content/tests/lumbridge-advisers/test_advisers.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const oracle = JSON.parse(fs.readFileSync(path.join(content, 'tests/lumbridge-advisers/dialogue-source.json'), 'utf8'));
const engine = path.resolve(content, '../engine');
process.chdir(engine);
const load = async name => (await import(pathToFileURL(path.join(engine, 'src', name)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const Trigger = await load('engine/script/ServerTriggerType.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const IfSetText = await load('network/game/server/model/IfSetText.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const { BlockWalk } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/BlockWalk.ts')).href);
const cfg = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'NpcType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'CategoryType', 'StructType', 'MesanimType']) {
  cfg[name] = await load(`cache/config/${name}.ts`);
  cfg[name].load('data/pack');
}
(await load('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load('data/pack') > 0);
const { NpcType, VarPlayerType, Component } = cfg;
const pause = new ResumePauseButtonHandler();
const quests = { demonstart: 30, vampire: 3, imp: 2, cookquest: 2, runemysteries: 6, rjquest: 100, sheep: 22, doricquest: 100, hetty: 3, hunt: 4, haunted: 3 };
const completions = [
  ["I've already killed the demon Delrith.", 'Thanks for the tip, perhaps I will.'],
  ['Oh I have already killed that nasty blood-sucking vampyre.', 'Thanks for the tip.'],
  ['Yes I know of Mizgog and have already helped him', 'Thanks for your help.'],
  ['I have already helped the cook in Lumbridge.', 'Thank you. I shall go speak with him.'],
  ['Yes, I have already solved the Rune mysteries.', 'Sounds mysterious. I may just do that. Thanks.'],
  ["Oh yes, I've already helped Romeo", 'Right, ok. Romeo is in Varrock?'],
  ['I have already helped Fred the farmer.', 'Thanks, maybe I will.'],
  ["Yes, I've been to see Doric already.", 'Thanks for the tip.'],
  ['Yes, I have already been to see Hetty', "Ok thanks, let's hope she doesn't turn me into a potato or something.."],
  ['Yarr! I already found the booty!', 'Sounds adventurous, I may have to check that out. Thank you.'],
  ['Yeah, I found Ernest already.', "Sounds like fun. I've never been to a Haunted Manor before."]
].map(pair => pair.map(prefix => {
  const matches = oracle.speech.filter(line => line.startsWith(prefix));
  assert.equal(matches.length, 1, `completion expectation must identify one retained speech line: ${prefix}`);
  return matches[0];
}));
const requiredLabels = ['where', 'weather', 'up', 'free', 'stick', 'hair', 'lace', 'cellar', 'quests', 'bye', 'fight', 'demon', 'vampire', 'imp', 'easy', 'cook', 'runes', 'romeo', 'skills', 'sheep', 'doric', 'all', 'hetty', 'pirate', 'ernest'];
const seenLabels = new Set();
let conversations = 0;
function spawnRows(name) {
  const id = NpcType.getId(name), rows = [];
  assert(id >= 0);
  for (const file of fs.readdirSync(path.join(content, 'maps')).filter(x => /^m\d+_\d+\.jm2$/.test(x))) {
    const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file);
    let section = '';
    for (const line of fs.readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) section = line;
      if (!section.includes('NPC')) continue;
      const m = /^(\d+) (\d+) (\d+): (\d+)$/.exec(line);
      if (m && Number(m[4]) === id) rows.push({ level: +m[1], x: +mx * 64 + +m[2], z: +mz * 64 + +m[3] });
    }
  }
  assert.equal(rows.length, 2, `${name}: both retained 377 placements`);
  return rows;
}
const expectedTerminalRoutes = { new: 108, almost: 108, complete: 108, cellar: 37 };
function normalizeTranscriptText(text) {
  return text.replaceAll('|', ' ').replace(/\s+/g, ' ').trim();
}
const oracleSpeech = new Set(oracle.speech.map(normalizeTranscriptText));
const oracleOptions = new Set(oracle.options.map(normalizeTranscriptText));

function dialoguePages(packets) {
  const pages = [];
  let current = null;
  const finish = () => {
    if (current) pages.push(current);
    current = null;
  };
  for (const message of packets) {
    if (!(message instanceof IfSetText)) continue;
    const component = Component.get(message.component)?.comName;
    assert.equal(typeof component, 'string', `unmapped IfSetText component ${message.component}`);
    let match = /^(npcchat|chat)([1-4]):com_([1-5])$/.exec(component);
    if (match) {
      const [, family, page, slotText] = match;
      const interfaceName = `${family}${page}`;
      const slot = Number(slotText);
      if (slot === 1) {
        finish();
        current = { kind: 'speech', interfaceName, speaker: family === 'npcchat' ? 'npc' : 'player', name: message.text, lines: [] };
      } else {
        assert.equal(current?.kind, 'speech', `speech line without a header at ${component}`);
        assert.equal(current.interfaceName, interfaceName, `speech page changed at ${component}`);
        assert.equal(slot, current.lines.length + 2, `speech line order at ${component}`);
        current.lines.push(message.text);
      }
      continue;
    }
    match = /^(multi[2-5]):com_([0-5])$/.exec(component);
    if (match) {
      const [, interfaceName, slotText] = match;
      const slot = Number(slotText);
      if (slot === 0) {
        finish();
        current = { kind: 'menu', interfaceName, title: message.text, options: [] };
      } else {
        assert.equal(current?.kind, 'menu', `menu option without a title at ${component}`);
        assert.equal(current.interfaceName, interfaceName, `menu changed at ${component}`);
        assert.equal(slot, current.options.length + 1, `menu option order at ${component}`);
        assert(slot <= Number(interfaceName.slice('multi'.length)), `option outside ${interfaceName}`);
        current.options.push(message.text);
      }
      continue;
    }
    assert.fail(`unexpected dialogue text component ${component}: ${JSON.stringify(message.text)}`);
  }
  finish();
  return pages;
}

function assertDialoguePages(pages, npcName, playerName, seenSpeech, seenOptions, modeSpeech, context) {
  for (const page of pages) {
    if (page.kind === 'speech') {
      assert(page.lines.length >= 1 && page.lines.length <= 4, `${context}: empty or oversized speech page`);
      const expectedSpeaker = page.speaker === 'npc' ? npcName : playerName;
      assert.equal(page.name, expectedSpeaker, `${context}: unexpected ${page.speaker} name`);
      const text = normalizeTranscriptText(page.lines.join(' '));
      const sourceLine = text === `Oh good, Thank you ${playerName}!` ? 'Oh good, Thank you {name}!' : text;
      assert(oracleSpeech.has(sourceLine), `${context}: unsourced ${page.speaker} speech ${JSON.stringify(text)}`);
      seenSpeech.add(sourceLine);
      modeSpeech.add(sourceLine);
    } else {
      const optionCount = Number(page.interfaceName.slice('multi'.length));
      assert.equal(page.options.length, optionCount, `${context}: incomplete ${page.interfaceName} menu`);
      assert.equal(normalizeTranscriptText(page.title), 'Select an Option', `${context}: unexpected menu title`);
      for (const rawOption of page.options) {
        const option = normalizeTranscriptText(rawOption);
        assert(oracleOptions.has(option), `${context}: unsourced ${page.interfaceName} option ${JSON.stringify(option)}`);
        seenOptions.add(option);
      }
    }
  }
}

function run(name, tile, mode, seed, choices) {
  World.currentTick = 100;
  const p = new Player('advisertest', 1n, 0n);
  p.pid = 1; p.uid = 1; p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99);
  p.level = tile.level; p.x = tile.x; p.z = tile.z - 1;
  p.buildArea.originX = tile.x - 32; p.buildArea.originZ = tile.z - 32;
  for (const [q, value] of Object.entries(quests)) {
    const id = VarPlayerType.getId(q);
    assert(id >= 0, `missing quest varp ${q}`);
    p.setVar(id, mode === 'complete' ? value : mode === 'almost' ? value - 1 : 0);
  }
  const tribe = cfg.VarBitType.getId('lost_tribe_quest');
  assert(tribe >= 0);
  p.setVarBit(tribe, mode === 'cellar' ? 1 : 0);
  const before = p.vars.slice(), packets = [];
  p.write = message => packets.push(message);
  const t = NpcType.getByName(name);
  const n = new Npc(tile.level, tile.x, tile.z, t.size, t.size, EntityLifeCycle.RESPAWN, 1, t.id, BlockWalk.NONE);
  n.isActive = true; n.lastMovement = -100;
  assert.equal(t.op[0], 'Talk-to');
  p.target = n; p.targetOp = Trigger.OPNPC1 - 7;
  const script = p.getOpTrigger();
  assert.equal(script?.name, `[opnpc1,${name}]`, 'engine resolves the exact placed type');
  // Seed the production Java RNG, not an opcode replacement or a dialogue mock.
  JavaRandom.setSeed(seed);
  const state = ScriptRunner.init(script, p, n);
  p.executeScript(state, true);
  let choice = 0;
  for (let steps = 0; steps < 180; steps++) {
    for (const current of [state.script, ...state.frames.slice(0, state.fp).map(f => f.script)]) {
      if (current.name.startsWith('[label,adviser_')) seenLabels.add(current.name);
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, `${name} ${mode} aborted`);
    if (state.execution === ScriptState.FINISHED) {
      assert.equal(choice, choices.length, 'all requested choices consumed');
      assert.deepEqual(p.vars, before, 'advice never changes quest or remembered state');
      conversations++;
      return { done: true, observations: dialoguePages(packets), npcName: t.name, playerName: p.displayName };
    }
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false; p.executeScript(state, true, true); continue;
    }
    assert.equal(state.execution, ScriptState.PAUSEBUTTON);
    const menu = Component.get(p.modalChat)?.comName;
    if (/^multi[2-5]$/.test(menu)) {
      const count = Number(menu.slice(5));
      if (choice === choices.length) {
        const observations = dialoguePages(packets);
        const current = observations.at(-1);
        assert.equal(current?.kind, 'menu', `${name} ${mode}: no observed choice menu`);
        assert.equal(current.interfaceName, menu, `${name} ${mode}: active menu identity differs from IfSetText`);
        assert.equal(current.options.length, count, `${name} ${mode}: active menu option count`);
        return { done: false, count, menu: current.options, observations, npcName: t.name, playerName: p.displayName };
      }
      const index = choices[choice++];
      assert(index >= 1 && index <= count);
      const component = Component.getId(`${menu}:com_${index}`);
      assert(p.resumeButtons.includes(component));
      p.lastCom = component;
      assert(pause.handle(new ResumePauseButton(component), p));
    } else assert(pause.handle(new ResumePauseButton(0), p));
  }
  assert.fail('conversation exceeded 180 production resumes');
}
for (const name of ['lumbridge_guide2_man', 'lumbridge_guide2_woman']) {
  for (const tile of spawnRows(name)) {
    const seenSpeech = new Set(), seenOptions = new Set();
    for (const mode of ['new', 'almost', 'complete', 'cellar']) {
      const modeSpeech = new Set();
      const menus = new Map();
      for (let i = 0; i < 100 && menus.size < (mode === 'cellar' ? 1 : 4); i++) {
        const seed = i * 100003 + 1;
        const result = run(name, tile, mode, seed, []);
        assert.equal(result.done, false);
        assertDialoguePages(result.observations, result.npcName, result.playerName, seenSpeech, seenOptions, modeSpeech, `${name} ${mode} menu seed ${seed}`);
        const signature = JSON.stringify(result.menu.map(normalizeTranscriptText));
        if (!menus.has(signature)) menus.set(signature, seed);
      }
      assert.equal(menus.size, mode === 'cellar' ? 1 : 4, 'all four sourced random menus are reachable');
      let terminalRoutes = 0;
      for (const seed of menus.values()) {
        const pending = [[]];
        for (let at = 0; at < pending.length; at++) {
          const route = pending[at], result = run(name, tile, mode, seed, route);
          const context = `${name} ${mode} seed ${seed} route ${JSON.stringify(route)}`;
          assertDialoguePages(result.observations, result.npcName, result.playerName, seenSpeech, seenOptions, modeSpeech, context);
          if (result.done) terminalRoutes++;
          else for (let option = 1; option <= result.count; option++) pending.push([...route, option]);
          assert(pending.length < 250, 'bounded dialogue tree');
        }
      }
      assert.equal(terminalRoutes, expectedTerminalRoutes[mode], `${name} ${tile.level}:${tile.x},${tile.z} ${mode}: terminal route count`);
      assert(modeSpeech.has(normalizeTranscriptText('Hello there, can I help you?')), `${mode}: missing greeting`);
      const cellarLine = oracle.speech.find(line => line.startsWith('I heard the wall collapsed or something.'));
      assert(cellarLine, 'oracle omits the cellar response');
      assert.equal(modeSpeech.has(normalizeTranscriptText(cellarLine)), mode === 'cellar', `${mode}: cellar response`);
      for (const [complete, unfinished] of completions) {
        assert.equal(modeSpeech.has(normalizeTranscriptText(complete)), mode === 'complete', `${mode}: completion branch ${complete}`);
        if (mode !== 'complete') assert(modeSpeech.has(normalizeTranscriptText(unfinished)), `${mode}: incomplete branch ${unfinished}`);
      }
      console.log(`PASS ${name} ${tile.level}:${tile.x},${tile.z} ${mode}: ${terminalRoutes} terminal routes`);
    }
    for (const line of oracle.speech) assert(seenSpeech.has(normalizeTranscriptText(line)), `${name} at ${tile.x},${tile.z}: unreached sourced speech ${line}`);
    for (const option of oracle.options) assert(seenOptions.has(normalizeTranscriptText(option)), `${name} at ${tile.x},${tile.z}: unreached sourced option ${option}`);
  }
}
assert.equal(conversations, 1444, 'four retained placements × all four states have 1,444 terminal routes');
for (const label of requiredLabels) assert(seenLabels.has(`[label,adviser_${label}]`), `unreached compiled label ${label}`);
console.log(`PASS ${conversations} complete conversations; every branch and all four placed spawns answer without state writes`);
process.exit(0);
