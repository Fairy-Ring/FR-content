/** Real packed tanning scripts; transport-free, not a client rendering proof. */
import assert from 'node:assert/strict';
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

let captionCases = 0;

for (const town of towns) {
  const p = player(town);
  open(p, town);
  const text = number => p.packets.find(packet => packet.kind === 'IfSetText' && packet.component === com(number))?.text;
  const model = number => p.packets.find(packet => packet.kind === 'IfSetObject' && packet.component === com(number));
  const names = ['Soft leather', 'Hard leather', 'Snake skin', 'Snake skin', "Green D'hide", "Blue D'hide", "Red D'hide", "Black D'hide"];
  const models = ['cow_hide', 'cow_hide', 'templetrek_swamp_snake_hide', 'village_snake_hide', 'dragonhide_green', 'dragonhide_blue', 'dragonhide_red', 'dragonhide_black'];
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
// Authored from tanning's one-hide/one-leather rule and the six original
// products/prices. These are expectations, not recordings from a published pack.
const products = [
  ['cow_hide', 'leather', 0, 'cowhides', 'soft leather'],
  ['cow_hide', 'hard_leather', 1, 'cowhide', 'hard leather'],
  ['dragonhide_green', 'dragon_leather', 4, 'dragonhides', 'dragon leather'],
  ['dragonhide_blue', 'dragon_leather_blue', 5, 'dragonhides', 'dragon leather'],
  ['dragonhide_red', 'dragon_leather_red', 6, 'dragonhides', 'dragon leather'],
  ['dragonhide_black', 'dragon_leather_black', 7, 'dragonhides', 'dragon leather']
];
const fixtures = [
  ['plenty', 8, 1000, 3, false], ['two-hides', 2, 1000, 3, false], ['one-coin-short', 1, 0, 3, false],
  ['no-hide', 0, 1000, 3, false], ['partial-coins', 8, 2, 3, false], ['x-zero', 8, 1000, 0, false],
  ['x-big', 8, 1000, 100, false], ['full-inventory', 8, 1000, 3, true], ['exact-coins-3', 8, 60, 3, false],
  ['snake-also-present', 8, 1000, 3, false, true]
];
const inventory = p => new Map(p.getInventory(inv).items.filter(Boolean).map(item => [item.id, p.invTotal(inv, item.id)]));
let compared = 0;
for (const town of towns) for (const [rawName, outputName, tile, plural, material] of products) {
  const raw = obj(rawName), output = obj(outputName);
  const cost = town.old[tile < 2 ? tile : tile - 2];
  for (const mode of ['one', 'five', 'x', 'all']) {
    for (const [label, count, money, input, full, snake] of fixtures) {
      const p = player(town);
      if (count) p.invAdd(inv, raw, count);
      if (money) p.invAdd(inv, coins, money);
      if (snake) for (const hide of hides) p.invAdd(inv, hide, 2);
      if (full) p.invAdd(inv, obj('knife'), p.invFreeSpace(inv));
      const expected = inventory(p), xp = [...p.stats];
      open(p, town);
      const from = p.packets.length;
      const request = { one: 1, five: 5, x: input, all: count }[mode];
      const cancelled = mode === 'x' && input <= 0;
      const amount = cancelled ? 0 : Math.min(request, count, Math.floor(money / cost));
      const messages = [];
      if (!cancelled) {
        if (!count) messages.push(`You don't have any ${plural} to tan.`);
        else if (money < cost) messages.push(`You haven't got enough coins to pay for ${material}.`);
        else {
          messages.push(amount === 1 ? `The tanner tans your ${tile < 2 ? 'cowhide' : 'dragonhide'}.`
            : `The tanner tans ${amount} ${plural} for you.`);
          if (money - amount * cost < cost && request > amount)
            messages.push(`You haven't got enough coins to pay for more ${material}.`);
        }
      }
      if (amount) {
        expected.set(raw, count - amount);
        expected.set(coins, money - amount * cost);
        expected.set(output, amount);
        for (const [key, value] of expected) if (!value) expected.delete(key);
      }
      click(p, tile, mode, input);
      const context = `${town.name} ${outputName} ${mode} ${label}`;
      assert.deepEqual(inventory(p), expected, `${context}: exact product, materials, coins and unrelated items`);
      assert.deepEqual([...p.stats], xp, `${context}: tanning awards no XP`);
      assert.equal(p.modalMain, amount ? -1 : root, `${context}: only settlement closes the menu`);
      assert.deepEqual(p.packets.slice(from).filter(packet => packet.kind === 'MessageGame').map(packet => packet.msg),
        messages, `${context}: refusal or settlement wording`);
      compared++;
    }
  }
}
console.log(`PASS ${compared} authored original-product settlement cases`);

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
console.log(`PASS ${cases} exact snake settlement cases`);
// Engine imports retain service handles; this offline fixture starts no server.
process.exit(0);
