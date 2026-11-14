// Run the packed production Eblis Talk-to trigger through the real script runner.
// From the sibling engine: node --import tsx ../content/tests/small-repairs/test_r2_eblis.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
  types[name] = await load(`cache/config/${name}.ts`);
  types[name].load(pack);
}
assert.ok(ScriptProvider.load(pack) > 0, 'full compiled pack required');
assert.ok(types.FontType.get(3), 'client title font pack required');
World.currentTick = 100;
World.gameMap.init();

function packedId(file, name) {
  const text = fs.readFileSync(path.join(content, 'pack', file), 'utf8');
  const match = text.match(new RegExp(`^(\\d+)=${name}$`, 'm'));
  assert.ok(match, `pack/${file} missing ${name}`);
  return Number(match[1]);
}
const desertTreasure = packedId('varbit.pack', 'deserttreasure');
const eblisType = packedId('npc.pack', 'fd_elder_village');
const componentId = name => packedId('interface.pack', name);
let serial = 0;
function fixture(stage) {
  const player = new Player(`eblis_r2_${++serial}`, BigInt(serial), BigInt(serial));
  player.uid = serial; player.pid = serial; player.slot = serial;
  player.vars.fill(0); player.packets = []; player.messages = [];
  player.setVarBit(desertTreasure, stage);
  player.write = packet => {
    player.packets.push(packet);
  };
  player.messageGame = text => player.messages.push(text);
  player.wrappedMessageGame = player.messageGame;
  const npc = new Npc(0, 3289, 3312, 0, 1, EntityLifeCycle.RESPAWN, 1, eblisType, types.NpcType.get(eblisType).blockwalk);
  return { player, npc };
}
function startTalk(stage) {
  const { player, npc } = fixture(stage);
  const script = ScriptProvider.getByName('[opnpc1,fd_elder_village]');
  assert.ok(script, 'packed [opnpc1,fd_elder_village] missing');
  const state = ScriptRunner.init(script, player, npc);
  const execution = player.runScript(state, true, true);
  return { player, state, execution };
}
const pageText = player => player.packets
  .filter(packet => packet.constructor.name === 'IfSetText')
  .map(packet => packet.text)
  .join(' ')
  .replace(/[|\s]+/g, ' ')
  .trim();

// Values below stage 5 all take the pre-Museum path. It must return before
// emitting either an interface page or an ordinary game message.
for (let stage = 0; stage < 5; stage++) {
  const { player, state, execution } = startTalk(stage);
  assert.equal(execution, ScriptState.FINISHED, `stage ${stage} Talk-to returns normally`);
  assert.equal(state.execution, ScriptState.FINISHED, `stage ${stage} does not suspend for fallback dialogue`);
  assert.equal(player.modalChat, -1, `stage ${stage} opens no dialogue page`);
  assert.deepEqual(player.packets, [], `stage ${stage} sends no network output`);
  assert.deepEqual(player.messages, [], `stage ${stage} sends no script game message`);
}
console.log('PASS Eblis stages 0–4: Talk-to returns silently with no page, network packet, or game message');

// Published stage 5/6 Museum dialogue remains reachable and begins with the
// exact existing player/NPC exchange. Resume production Continue pauses until
// the live four-choice menu, then choose the existing Nothing branch.
for (const stage of [5, 6]) {
  const { player, state } = startTalk(stage);
  let execution = state.execution;
  for (let step = 0; step < 24; step++) {
    assert.notEqual(execution, ScriptState.ABORTED, `stage ${stage} dialogue did not abort`);
    if (execution === ScriptState.PAUSEBUTTON && player.modalChat === componentId('multi4')) break;
    assert.equal(execution, ScriptState.PAUSEBUTTON, `stage ${stage} reaches normal dialogue Continue/menu`);
    execution = player.runScript(state, true, true);
  }
  assert.equal(execution, ScriptState.PAUSEBUTTON, `stage ${stage} opens its published four-choice menu`);
  assert.equal(player.modalChat, componentId('multi4'));
  assert.deepEqual(pageText(player).split(' ').length > 0, true);
  const texts = pageText(player);
  assert.ok(texts.includes('Hello. I represent the Museum of Varrock, and I have reason to believe there may be some kinds of artefacts of historical significance in the nearby area...'), `stage ${stage} retains the Museum opening`);
  assert.ok(texts.includes('Ah yes. The only time people care about our existence is when they think they have something to gain from us.'), `stage ${stage} retains Eblis's exact opening reply`);
  assert.ok(player.resumeButtons.includes(componentId('multi4:com_4')), 'Nothing remains a published choice');
  player.lastCom = componentId('multi4:com_4');
  execution = player.runScript(state, true, true);
  for (let step = 0; execution !== ScriptState.FINISHED && step < 24; step++) {
    assert.equal(execution, ScriptState.PAUSEBUTTON, `stage ${stage} follow-up uses ordinary dialogue pauses`);
    execution = player.runScript(state, true, true);
  }
  assert.equal(execution, ScriptState.FINISHED, `stage ${stage} Museum conversation finishes`);
  assert.equal(player.getVarBit(desertTreasure), stage, `stage ${stage} Nothing branch does not advance the quest`);
}
console.log('PASS Eblis stages 5–6: unchanged Museum opening, choices, and non-progress branch');

// Stage 7 includes the later five-choice conversation and the diamond/list
// branch. Choosing Yes commits the existing 7→8 quest progress.
{
  const { player, state } = startTalk(7);
  let execution = state.execution;
  for (let step = 0; step < 32; step++) {
    assert.notEqual(execution, ScriptState.ABORTED, 'stage 7 dialogue did not abort');
    if (execution === ScriptState.PAUSEBUTTON && player.modalChat === componentId('multi5')) break;
    assert.equal(execution, ScriptState.PAUSEBUTTON, 'stage 7 advances through production dialogue pauses');
    execution = player.runScript(state, true, true);
  }
  assert.equal(execution, ScriptState.PAUSEBUTTON);
  assert.equal(player.modalChat, componentId('multi5'), 'stage 7 opens its published five-choice menu');
  const texts = pageText(player);
  assert.ok(texts.includes('Hello. I represent the Museum of Varrock, and I have reason to believe there may be some kinds of artefacts of historical significance in the nearby area...'));
  assert.ok(texts.includes('I have nothing to say to you. You and your kind are not welcome here.'));
  const choose = option => {
    const id = componentId(`multi5:com_${option}`);
    assert.ok(player.resumeButtons.includes(id), `stage 7 offers choice ${option}`);
    player.lastCom = id;
    execution = player.runScript(state, true, true);
  };
  choose(4); // Diamonds of Azzanadra.
  // The branch asks for Yes/No, then opens the ingredient dialogue, which
  // asks again whether to fetch the ingredients. Advance real Continue pages.
  const selectMenu = async (menu, option) => {
    for (let step = 0; step < 50; step++) {
      if (execution === ScriptState.PAUSEBUTTON && player.modalChat === componentId(menu)) break;
      assert.equal(execution, ScriptState.PAUSEBUTTON, `stage 7 reaches ${menu} via dialogue pauses`);
      execution = player.runScript(state, true, true);
    }
    assert.equal(execution, ScriptState.PAUSEBUTTON);
    assert.equal(player.modalChat, componentId(menu), `stage 7 opens ${menu}`);
    const id = componentId(`${menu}:com_${option}`);
    assert.ok(player.resumeButtons.includes(id), `${menu} offers choice ${option}`);
    player.lastCom = id;
    execution = player.runScript(state, true, true);
  };
  await selectMenu('multi2', 1);
  await selectMenu('multi2', 1);
  for (let step = 0; execution !== ScriptState.FINISHED && step < 60; step++) {
    assert.equal(execution, ScriptState.PAUSEBUTTON, 'stage 7 list finishes through production Continue pages');
    execution = player.runScript(state, true, true);
  }
  assert.equal(execution, ScriptState.FINISHED, 'stage 7 diamond/list branch finishes');
  assert.equal(player.getVarBit(desertTreasure), 8, 'agreeing to fetch ingredients advances stage 7 to stage 8');
  const allText = pageText(player);
  assert.ok(allText.includes('Did you ever hear of something called the Diamonds of Azzanadra?'), 'diamond branch retains its existing opening');
  assert.ok(allText.includes('12 magic logs, 6 pieces of molten glass, and 6 steel bars.'), 'ingredient list remains available');
}
console.log('PASS Eblis stage 7: published diamond/ingredient path advances to stage 8');

// Later direct Talk-to branches stay live: stage 8's shortage speech and
// stage 10's East-location speech each suspend on a real production dialogue.
for (const [stage, expected] of [
  [8, 'Before I can complete the spell I will still need the following items;'],
  [10, 'Meet me again in the desert East of here, I will use these ingredients to create a scrying glass for you.']
]) {
  const { player, state } = startTalk(stage);
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, `stage ${stage} suspends on production dialogue`);
  assert.notEqual(player.modalChat, -1, `stage ${stage} opens dialogue`);
  assert.ok(pageText(player).includes(expected), `stage ${stage} keeps exact existing speech`);
  assert.deepEqual(player.messages, [], `stage ${stage} dialogue is a page, not a script game message`);
}
console.log('PASS Eblis stages 8 and 10: later dialogue still executes and opens normally');
console.log('RESULT PASS packed production Eblis Talk-to regression');
process.exit(0);
