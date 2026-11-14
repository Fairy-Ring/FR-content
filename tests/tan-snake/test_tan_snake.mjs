/** Real packed tanning scripts; transport-free, not a client rendering proof. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const { BlockWalk } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/BlockWalk.ts')).href);
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const ScriptPointer = await load('engine/script/ScriptPointer.ts');
const IfButtonHandler = await load('network/game/client/handler/IfButtonHandler.ts');
const IfButton = await load('network/game/client/model/IfButton.ts');
const ResumePCountDialogHandler = await load('network/game/client/handler/ResumePCountDialogHandler.ts');
const ResumePCountDialog = await load('network/game/client/model/ResumePCountDialog.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType',
  'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType',
  'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  types[name] = await load(`cache/config/${name}.ts`);
  types[name].load(pack);
}
(await load('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load(pack) > 0);
World.currentTick = 100;
World.gameMap.init();
const { ObjType, InvType, Component, NpcType } = types;
const inv = InvType.getId('inv');
const obj = name => { const id = ObjType.getId(name); assert(id >= 0, name); return id; };
const com = number => Component.getId(`tanner:com_${number}`);
const root = Component.getId('tanner');
const coins = obj('coins');
const skin = obj('village_snake_skin');
const hides = [obj('village_snake_hide'), obj('templetrek_swamp_snake_hide')];
assert.deepEqual(hides, [6287, 7801]);
assert.equal(skin, 6289);
const towns = [
  { name: 'Ellis', npc: 'ellis_tanner', x: 3276, z: 3193, prices: [15, 20], old: [1, 3, 20, 20, 20, 20], opener: '[opnpc3,ellis_tanner]' },
  { name: 'Sbott', npc: 'werewolftanner', x: 3490, z: 3503, prices: [25, 45], old: [2, 5, 45, 45, 45, 45], opener: '[opnpc3,werewolftanner]' },
  { name: 'Guild', npc: 'ranging_guild_leatherworker', x: 2678, z: 3434, prices: [15, 20], old: [1, 3, 20, 20, 20, 20], opener: '[label,tan_leather_choices]' }
];
// The loaded map supplies Sbott for real NPC_FIND, without replacing a handler.
let serial = 0;
function player(town) {
  const p = new Player('tanning_fixture', BigInt(++serial), BigInt(serial));
  p.slot = serial;
  p.pid = serial;
  p.uid = serial;
  p.level = 0;
  p.x = town.x;
  p.z = town.z;
  p.isActive = true;
  p.packets = [];
  p.write = message => p.packets.push({ kind: message.constructor.name, ...message });
  p.getInventory(inv);
  return p;
}
function execute(p, name) {
  const script = ScriptProvider.getByName(name);
  assert(script, name);
  const state = ScriptRunner.init(script, p);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  p.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.FINISHED, name);
}
function open(p, town) { execute(p, town.opener); assert.equal(p.modalMain, root); }
const button = new IfButtonHandler();
const resume = new ResumePCountDialogHandler();
const pause = new ResumePauseButtonHandler();
const snakeTiles = [3, 2]; // Village, swamp; zero-based positions from the reconstruction.
function click(p, tile, mode, input = 3) {
  const base = { one: 146, five: 138, x: 130, all: 122 }[mode];
  assert.equal(button.handle(new IfButton(com(base + tile)), p), true);
  if (mode === 'x') {
    assert.equal(p.activeScript?.execution, ScriptState.COUNTDIALOG);
    assert.equal(resume.handle(new ResumePCountDialog(input), p), true);
  }
}
function totals(p) {
  return { coins: p.invTotal(inv, coins), hides: hides.map(hide => p.invTotal(inv, hide)), skins: p.invTotal(inv, skin) };
}
function seed(p, tile, count, money, full = false) {
  if (count > 0) assert.equal(p.invAdd(inv, hides[tile], count), count);
  if (money > 0) assert.equal(p.invAdd(inv, coins, money), money);
  if (full) {
    const free = p.invFreeSpace(inv);
    assert.equal(p.invAdd(inv, obj('knife'), free), free);
    assert.equal(p.invFreeSpace(inv), 0);
  }
}
let cases = 0;
function check(town, tile, mode, count, money, expectedCount, input = 3, full = false, message = null) {
  const p = player(town);
  seed(p, tile, count, money, full);
  const before = totals(p);
  open(p, town);
  const slots = p.getInventory(inv).items.map(item => item && { ...item });
  click(p, snakeTiles[tile], mode, input);
  const expected = { coins: money - expectedCount * town.prices[tile], hides: [0, 0], skins: expectedCount };
  expected.hides[tile] = count - expectedCount;
  assert.deepEqual(totals(p), expected, `${town.name} tile ${snakeTiles[tile] + 1} ${mode}: exact settlement from ${JSON.stringify(before)}`);
  if (expectedCount === 0) assert.deepEqual(p.getInventory(inv).items, slots, 'refusal leaves every slot unchanged');
  else assert.equal(p.modalMain, -1, 'successful tanning closes the interface');
  if (message) assert(p.packets.some(packet => packet.kind === 'MessageGame' && packet.msg === message), message);
  if (full && expectedCount) assert.equal(p.invTotal(inv, obj('knife')), 27 - count, 'unrelated full-inventory contents survive');
  cases++;
  return p;
}

// Decoded executable bytes/operands, excluding source line metadata. Captured before editing:
// content ccdca1101a225a38d2583e56ce1023ab028c8b75, engine ef96f86623697dc0d5367cc0a889c4c56eb091d3.
const publishedHashes = [
  '50444bbde9e2f7a528eddb02e8db9c62d6e3f3178e842dca9b7aa1c59e6bd296',
  'c0b83293bc374ca5ecd052bc46ef0e599cf534f30019c74c51536b3f6cd4b4d7',
  '55b4628bd2ec0ef42b72aa1fb1e864eec43b8c85d2a7efc84b1bb4356f0c795f',
  'b841f567ce93051d6280b9c27431f6270b29ac6411fcead5aa9933a555b29998',
  '00b002b0faed91d8c16baa8e0f06b9630aa3ed20493c95314719c3ef3b0ac6fb',
  '29c8e456505ef4ed19dd8d5bd57eef39ed42828889b3993bb2e1ad8ba54f0f5e',
  '98d53b16a880dcc60c1b75c5169961a3d27da15760a17d1118a141d03f66d764',
  '433fb0d71756e0e3cc7b75dab440a12dd6f4569e7cb7785bf1e3217ada04ff23',
  '87ba5394189b4ad7ce09dbbd005a550eb86e90aa9a236d670e586dc5a338da71',
  '42d2d413fe2812954ffdee5a98edd16ae5798831a06a66375b47d295a9c86d22',
  'e2543e50e50f0a75d2b76ab5bec159bd0aeaa36c98ab3558500f654cd39c329f',
  'f79758154f0132f0eb58aac633f6438f546525806750fa366e05ca3a013b9e69',
  '91ab1d8714902d2fe0ab8071e040bb5a0c379b2fcaa8c1b7e84abb77651f52f0',
  'a44fb26cb39008712d896ca5d0e32b2657475f0e7d84c3acc5adb843742745c6',
  '5fcd07ff22a1fce40f9cd5467b13fb651c8c87487b922abea3d83adb85bca438',
  '9da315fc286d53728a5ea08129cd7be2cb7724e8ede630f97a48a78e186366a8',
  '48dcf947c67f4075a1bb989830b2c9eb7febc25da4246e299d26ef4b027d8187',
  'aae35e689d1b2c963e9d220fb96b2fe3dff0da07191f139abd616e7bc7b569e1',
  'c0f290a956f4ce89e3ab6bc11845677e3b30bad72a41d2b08382ec9ca5799385',
  '2bc2fd7a42c216e3e3830b42085ad62d56cc7d108fcd9df6ab5d23ce9e7bc965',
  '5394d7a26bdd93c513ca34b3d940de9208596dc983f9266d5d5da65fd483f0cb',
  '2b643c19d0acd6093607f48698be7055caa5ef4e5d68e2672d70a006f47a7b4e',
  'e2aee4f1573c0c96ac3c760c1ccb6e345a9e37ddef40b3e5cea3d93505749654',
  'c44883549e8ebe85f49d8085375259ef09681a9a6ef2a4fbcfa0d89c9c9dc273',
  '735e58b1fdf6492e88d56c15affe8e768974c6fb9c628d0156c244d5f2a56186',
  'f69b22674ef7f167cca916a589ed133a22a410a69274902e9f35f342c8df1ce2',
  '50a27ffdea14b9820901882bf34da24dcc8b07294f4e72d2577ae8d35e2c1cf1',
  '57a602a834823d4d1472bf7a7820c6212b60732d2df9d29e3806482b4820d6c1'
];
const names = [];
for (const tile of [0, 1, 4, 5, 6, 7]) for (const base of [146, 138, 130, 122]) names.push(`[if_button,tanner:com_${base + tile}]`);
names.push('[label,tan_soft_leather]', '[label,tan_hard_leather]', '[label,tan_dragonhide]', '[proc,tan_leather]');
const fields = ['intLocalCount', 'stringLocalCount', 'intArgCount', 'stringArgCount', 'switchTables', 'opcodes', 'intOperands', 'stringOperands'];
// The compiler relocates script ids when eight buttons and a label are inserted.
// Resolve the same named destinations back to their captured published ids only;
// every opcode, other operand, string, switch and local/argument count stays exact.
const relocations = new Map([
  ['[label,tan_soft_leather]', 224], ['[label,tan_hard_leather]', 225],
  ['[label,tan_dragonhide]', 226], ['[proc,tan_leather]', 227]
].map(([name, published]) => [ScriptProvider.getByName(name).id, published]));
for (const [index, name] of names.entries()) {
  const script = ScriptProvider.getByName(name);
  assert(script, name);
  const executable = Object.fromEntries(fields.map(field => [field, script[field]]));
  executable.intOperands = script.intOperands.map((operand, pc) => {
    if (script.opcodes[pc] !== 40 && script.opcodes[pc] !== 41) return operand;
    assert(relocations.has(operand), `${name}: destination is still a published named helper`);
    return relocations.get(operand);
  });
  const hash = createHash('sha256').update(JSON.stringify(executable)).digest('hex');
  assert.equal(hash, publishedHashes[index], `published executable unchanged: ${name}`);
}
console.log('PASS published products: 24 relocated buttons, three labels and shared settlement executable fingerprints');
let captionCases = 0;

for (const town of towns) {
  const p = player(town);
  open(p, town);
  const text = number => p.packets.find(packet => packet.kind === 'IfSetText' && packet.component === com(number))?.text;
  const model = number => p.packets.find(packet => packet.kind === 'IfSetObject' && packet.component === com(number));
  const names = ['Soft leather', 'Hard leather', 'Snake skin', 'Snake skin', "Green D'hide", "Blue D'hide", "Red D'hide", "Black D'hide"];
  const models = ['leather', 'hard_leather', 'templetrek_swamp_snake_hide', 'village_snake_hide', 'dragonhide_green', 'dragonhide_blue', 'dragonhide_red', 'dragonhide_black'];
  const costs = [town.old[0], town.old[1], town.prices[1], town.prices[0], ...town.old.slice(2)];
  for (let i = 0; i < 8; i++) {
    assert.equal(text(106 + i), names[i]);
    assert.equal(text(114 + i), `${costs[i]} ${costs[i] === 1 ? 'coin' : 'coins'}`);
    assert.deepEqual(model(98 + i), { kind: 'IfSetObject', component: com(98 + i), obj: obj(models[i]), scale: 250 });
    for (const line of [106, 114]) {
      assert.equal(p.packets.find(packet => packet.kind === 'IfSetColour' && packet.component === com(line + i))?.colour,
        0x7C00, `${town.name} absent tile ${i + 1} line ${line} is red (RGB15 packet)`);
    }
  }
  for (let tile = 0; tile < 2; tile++) {
    const cost = town.prices[tile];
    for (const [mode, quantity] of [['one', 1], ['five', 5], ['x', 3], ['all', 8]]) check(town, tile, mode, 8, 8 * cost, quantity);
    check(town, tile, 'one', 1, cost, 1);
    check(town, tile, 'five', 2, 10 * cost, 2);
    check(town, tile, 'all', 8, 2 * cost + 1, 2);
    check(town, tile, 'one', 1, cost - 1, 0, 3, false, "You haven't got enough coins to pay for snakeskin.");
    check(town, tile, 'one', 0, cost, 0, 3, false, "You don't have any snake hides to tan.");
    check(town, tile, 'all', 8, 0, 0);
    check(town, tile, 'x', 8, 8 * cost, 0, 0);
    check(town, tile, 'x', 8, 8 * cost, 0, -1);
    check(town, tile, 'all', 8, 8 * cost, 8, 3, true);
    check(town, tile, 'all', 8, 8 * cost + 1, 8, 3, true);
  }
  const inputs = ['cow_hide', 'cow_hide', ...models.slice(2)];
  for (const raw of new Set(inputs)) {
    const held = player(town);
    held.invAdd(inv, obj(raw), 1);
    open(held, town);
    for (let i = 0; i < 8; i++) {
      for (const line of [106, 114]) {
        assert.equal(held.packets.find(packet => packet.kind === 'IfSetColour' && packet.component === com(line + i))?.colour,
          inputs[i] === raw ? 0x033F : 0x7C00, `${town.name} held ${raw} tile ${i + 1} line ${line} uses default light blue or absent red`);
      }
    }
    captionCases++;
  }
  const reopened = player(town);
  for (const raw of new Set(inputs)) reopened.invAdd(inv, obj(raw), 1);
  for (const held of [true, false]) {
    reopened.packets = [];
    open(reopened, town);
    const colours = reopened.packets.filter(packet => packet.kind === 'IfSetColour');
    assert.equal(colours.length, 16, 'every opening explicitly sets both lines of all eight tiles');
    for (const packet of colours) assert.equal(packet.colour, held ? 0x033F : 0x7C00, 'opening reflects current raw hides without coins');
    for (const raw of new Set(inputs)) reopened.invDel(inv, obj(raw), 1);
  }
  console.log(`PASS ${town.name}: eight ordered captions/costs/pictures, both snake settlements, Tan 1/5/X/All, caps, refusals, full inventory`);
}
// Each mutant changes only a scratch in-memory compiled button and is always restored.
// Running the same exact-settlement assertion must reject the wrong hide for each tile.
for (let tile = 0; tile < 2; tile++) {
  const script = ScriptProvider.getByName(`[if_button,tanner:com_${146 + snakeTiles[tile]}]`);
  const operand = script.intOperands.indexOf(hides[tile]);
  assert(operand >= 0, 'packed button contains its hide operand');
  const saved = script.intOperands[operand];
  try {
    script.intOperands[operand] = hides[1 - tile];
    assert.throws(() => check(towns[0], tile, 'one', 1, 100, 1), { code: 'ERR_ASSERTION' });
  } finally {
    script.intOperands[operand] = saved;
  }
  check(towns[0], tile, 'one', 1, 100, 1);
  console.log(`PASS tile ${snakeTiles[tile] + 1} scratch wrong-hide mutant rejected; restored script passes`);
}
// Baseline outcomes were captured from the real published pack by reviewer C.
// Its IfSetObject packets identify each product's original tile. On this head,
// find the product by its IfSetObject packet again, not by the old button id.
const published = JSON.parse(readFileSync(path.join(content, 'tests/tan-snake/published-products.json'), 'utf8'));
const fixtures = [
  ['plenty', 8, 1000, 3, false], ['two-hides', 2, 1000, 3, false], ['one-coin-short', 1, 0, 3, false],
  ['no-hide', 0, 1000, 3, false], ['partial-coins', 8, 2, 3, false], ['x-zero', 8, 1000, 0, false],
  ['x-big', 8, 1000, 100, false], ['full-inventory', 8, 1000, 3, true], ['exact-coins-3', 8, 60, 3, false],
  ['snake-also-present', 8, 1000, 3, false, true]
];
const inventory = p => p.getInventory(inv).items.map(item => item && `${ObjType.get(item.id).debugname}x${item.count}`).filter(Boolean).join(',');
let compared = 0;
for (const town of towns) for (const [modelName, product] of Object.entries(published.products)) {
  const raw = product.publishedTile < 2 ? obj('cow_hide') : obj(modelName);
  for (const mode of ['one', 'five', 'x', 'all']) {
    const outcomes = [];
    for (const [, count, money, input, full, snake] of fixtures) {
      const p = player(town);
      if (count) p.invAdd(inv, raw, count);
      if (money) p.invAdd(inv, coins, money);
      if (snake) for (const hide of hides) p.invAdd(inv, hide, 2);
      if (full) p.invAdd(inv, obj('knife'), p.invFreeSpace(inv));
      const before = inventory(p);
      open(p, town);
      const fill = p.packets.find(packet => packet.kind === 'IfSetObject' && packet.obj === obj(modelName));
      assert(fill, `product picture ${modelName}`);
      const tile = Array.from({ length: 8 }, (_, i) => i).find(i => com(98 + i) === fill.component);
      assert(Number.isInteger(tile), 'product picture belongs to a tile');
      const from = p.packets.length;
      click(p, tile, mode, input);
      outcomes.push({ before, handled: true, countdialog: mode === 'x', after: inventory(p), modalMain: p.modalMain,
        messages: p.packets.slice(from).filter(packet => packet.kind === 'MessageGame').map(packet => packet.msg) });
      compared++;
    }
    assert.equal(createHash('sha256').update(JSON.stringify(outcomes)).digest('hex'), product.results[town.name][mode],
      `${town.name} ${modelName} ${mode}: coins, items, messages and interface equal published pack`);
  }
}
console.log(`PASS ${compared} published-pack comparisons by product: 6 products x 4 modes x 10 fixtures x 3 tanners`);

// Resume real packed Talk scripts and option buttons; no replacement opener.
let entryCases = 0;
function talk(town, hide, use = false) {
  const p = player(town);
  p.invAdd(inv, hide, 1);
  const typeId = NpcType.getId(town.npc);
  const type = NpcType.get(typeId);
  const npc = new Npc(0, 0, 0, type.size, type.size, EntityLifeCycle.RESPAWN, 9000 + serial, typeId, BlockWalk.NONE);
  npc.isActive = true;
  npc.x = town.x;
  npc.z = town.z;
  if (use) p.lastUseItem = hide;
  const script = ScriptProvider.getByName(`[${use ? 'opnpcu' : 'opnpc1'},${town.npc}]`);
  const state = ScriptRunner.init(script, p, npc);
  p.executeScript(state, true);
  const wanted = town.name === 'Guild' ? "I'd like you to tan something for me." : 'Yes please.';
  let chosen = null;
  for (let step = 0; step < 60 && state.execution !== ScriptState.FINISHED; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'dialogue script does not abort');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const texts = new Map(p.packets.filter(packet => packet.kind === 'IfSetText').map(packet => [packet.component, packet.text]));
      let component = 0;
      if (p.resumeButtons.length > 1) {
        component = p.resumeButtons.find(id => texts.get(id) === wanted);
        assert(Number.isInteger(component), `${town.name} snake-only Talk offers ${wanted}`);
        chosen = texts.get(component);
        p.lastCom = component;
      }
      pause.handle(new ResumePauseButton(component), p);
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil ?? 0);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else assert.fail(`unexpected dialogue execution ${state.execution}`);
  }
  if (!use) assert.equal(chosen, wanted);
  assert.equal(p.modalMain, root, `${town.name} ${use ? 'use hide' : 'Talk'} opens tanner`);
  entryCases++;
}
for (const town of towns) {
  for (const hide of hides) talk(town, hide);
}
for (const hide of hides) talk(towns[0], hide, true);
console.log(`PASS ${entryCases} snake-only Talk/use entries through packed dialogue and option resumes`);
console.log(`PASS ${captionCases} held-hide caption-colour states, plus absent-hide controls at all three tanners`);
console.log(`PASS ${cases} exact snake settlement cases; two caught wrong-hide mutants`);
// Engine imports retain service handles; this offline fixture starts no server.
process.exit(0);
