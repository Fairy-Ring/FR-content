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
];
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
      return { done: true, text: packets.filter(m => m instanceof IfSetText).map(m => m.text).join(' ').replaceAll('|', ' ').replace(/\s+/g, ' ') };
    }
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false; p.executeScript(state, true, true); continue;
    }
    assert.equal(state.execution, ScriptState.PAUSEBUTTON);
    const menu = Component.get(p.modalChat)?.comName;
    if (/^multi[2-5]$/.test(menu)) {
      const count = Number(menu.slice(5));
      if (choice === choices.length) return { done: false, count, menu: packets.filter(m => m instanceof IfSetText).slice(-count - 1).map(m => m.text).join('|') };
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
    const observed = [];
    for (const mode of ['new', 'almost', 'complete', 'cellar']) {
      const menus = new Map();
      for (let i = 0; i < 100 && menus.size < (mode === 'cellar' ? 1 : 4); i++) {
        const seed = i * 100003 + 1;
        const result = run(name, tile, mode, seed, []);
        assert.equal(result.done, false);
        if (!menus.has(result.menu)) menus.set(result.menu, seed);
      }
      assert.equal(menus.size, mode === 'cellar' ? 1 : 4, 'all four sourced random menus are reachable');
      const texts = [];
      for (const seed of menus.values()) {
        const pending = [[]];
        for (let at = 0; at < pending.length; at++) {
          const route = pending[at], result = run(name, tile, mode, seed, route);
          if (result.done) texts.push(result.text);
          else for (let option = 1; option <= result.count; option++) pending.push([...route, option]);
          assert(pending.length < 250, 'bounded dialogue tree');
        }
      }
      const all = texts.join(' ');
      observed.push(all);
      assert(all.includes('Hello there, can I help you?'));
      assert.equal(all.includes('I heard the wall collapsed or something.'), mode === 'cellar');
      for (const [complete, unfinished] of completions) {
        assert.equal(all.includes(complete), mode === 'complete', `${mode}: completion branch ${complete}`);
        if (mode !== 'complete') assert(all.includes(unfinished), `${mode}: incomplete branch ${unfinished}`);
      }
      console.log(`PASS ${name} ${tile.level}:${tile.x},${tile.z} ${mode}: ${texts.length} terminal routes`);
    }
    const all = observed.join(' ');
    for (const line of [...oracle.speech, ...oracle.options]) {
      // The only variable in the source wording is the player's display name.
      for (const segment of line.split('{name}')) assert(all.includes(segment), `${name} at ${tile.x},${tile.z}: unreached sourced line ${line}`);
    }
  }
}
for (const label of requiredLabels) assert(seenLabels.has(`[label,adviser_${label}]`), `unreached compiled label ${label}`);
console.log(`PASS ${conversations} complete conversations; every branch and all four placed spawns answer without state writes`);
process.exit(0);
