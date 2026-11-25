/** Original tool-leprechaun interface, custody, native buttons and saved-state contracts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, Scripts, State, types, id, inv, player, proc, add, count, load } from './runtime.mjs';
const Trigger = (await load('engine/script/ServerTriggerType.ts')).default;
const InvButton = (await load('network/game/client/model/InvButton.ts')).default;
const InvButtonHandler = (await load('network/game/client/handler/InvButtonHandler.ts')).default;
const CountReply = (await load('network/game/client/model/ResumePCountDialog.ts')).default;
const CountHandler = (await load('network/game/client/handler/ResumePCountDialogHandler.ts')).default;
const buttons = new InvButtonHandler(), counts = new CountHandler();
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const com = name => id('Component', name), obj = name => id('ObjType', name);
const storage = id('VarPlayerType', 'farming_tools');
assert.equal(storage, 615);
assert.equal(types.VarPlayerType.get(storage).scope, 1);
assert.equal(types.VarPlayerType.get(storage).transmit, true);
const toolNames = ['rake', 'dibber', 'spade', 'secateurs', 'watering_can_0', 'gardening_trowel', 'bucket_empty', 'bucket_compost', 'bucket_supercompost'];
// Independent oracle from the original cache varbit table and interface Max labels.
const bits = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 7], [8, 8], [9, 13], [14, 21], [22, 29]];
const maxima = [1, 1, 1, 1, 1, 1, 31, 255, 255];
const suffix = ['rake', 'dibber', 'spade', 'secateurs', 'wateringcan', 'trowel', 'buckets', 'compost', 'supercompost'];
const field = (p, i) => (p.getVar(storage) >>> bits[i][0]) & ((2 ** (bits[i][1] - bits[i][0] + 1)) - 1);
const stored = (p, i) => i === 4 ? Math.min(1, field(p, i)) : field(p, i);
// Independent subset of 377 Client.executeClientScript (11175-11296):
// original packed interface programs, not the reconstruction's count proc.
function clientScript(p, component, index) {
  const code = component.scripts?.[index]; assert(code, 'original count program exists');
  let at = 0, value = 0, operation = 0;
  for (;;) {
    const opcode = code[at++]; let next;
    if (opcode === 0) return value;
    if (opcode >= 15 && opcode <= 17) { operation = opcode - 14; continue; }
    if (opcode === 4) {
      assert.equal(code[at++], com('inventory:inv'));
      next = p.invTotal(inv, code[at++]);
    } else if (opcode === 14) {
      const bit = types.VarBitType.get(code[at++]);
      next = (p.getVar(bit.basevar) >>> bit.startbit) & (2 ** (bit.endbit - bit.startbit + 1) - 1);
    } else {
      assert.equal(opcode, 20, 'no unsupported original count opcode');
      next = code[at++];
    }
    if (operation === 0) value += next;
    else if (operation === 1) value -= next;
    else if (operation === 2 && next !== 0) value = Math.trunc(value / next);
    else if (operation === 3) value *= next;
    operation = 0;
  }
}
function clientText(p, name) {
  const component = types.Component.get(com(name));
  const active = component.scriptComparator?.every((comparison, i) => {
    const value = clientScript(p, component, i), bound = component.scriptOperand[i];
    if (comparison === 2) return value < bound;
    if (comparison === 3) return value > bound;
    if (comparison === 4) return value !== bound;
    return value === bound;
  });
  return (active && component.activeText ? component.activeText : component.text)
    .replace(/%([1-5])/g, (_, n) => clientScript(p, component, Number(n) - 1));
}
let checks = 0;
function test(name, action) { action(); checks++; console.log(`PASS ${name}`); }
function exchange(p, npc, trigger = Trigger.OPNPC3) {
  const type = types.NpcType.get(npc.type);
  const script = Scripts.getByTrigger(trigger, type.id, type.category);
  assert.equal(script?.name, `[opnpc${trigger === Trigger.OPNPC1 ? 1 : 3},farming_tools_leprechaun]`);
  const state = Runner.init(script, p, npc);
  assert.equal(p.runScript(state, true, true), State.FINISHED);
  assert.equal(p.modalMain, com('tool_leprechaun'));
  assert.equal(p.modalSide, com('tool_leprechaun_side'));
}
function button(p, side, i, option = 1, amount) {
  const component = com(`${side ? 'tool_leprechaun_side' : 'tool_leprechaun'}:com_${side ? (i < 6 ? 0 : 1) : (i < 6 ? 67 : 68)}`);
  const listener = p.invListeners.find(l => l.com === component);
  assert(listener, 'interface selector has its actual transmitted inventory');
  const item = p.getInventoryFromListener(listener).get(i < 6 ? i : i - 6);
  assert(item, `selector ${i} has an icon even at zero held/stored count`);
  assert(buttons.handle(new InvButton(option, item.id, i < 6 ? i : i - 6, component), p));
  if (option === 4) {
    assert.equal(p.activeScript?.execution, State.COUNTDIALOG);
    assert(counts.handle(new CountReply(amount), p));
  }
  assert(!p.activeScript || p.activeScript.execution === State.FINISHED, 'button finishes without script abort');
}
const placements = [];
for (const file of fs.readdirSync(path.join(content, 'maps')).filter(file => /^m\d+_\d+\.jm2$/.test(file))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'NPC') continue;
    const row = /^([0-3]) (\d+) (\d+): (\d+)(?: |$)/.exec(line);
    if (!row) continue;
    const [level, x, z, type] = row.slice(1).map(Number);
    if (types.NpcType.get(type).name === 'Tool Leprechaun') placements.push({ level, x: mx * 64 + x, z: mz * 64 + z, type, file });
  }
}
assert(placements.length > 1, 'original map contains multiple leprechauns');
const actors = placements.map(at => {
  const npc = [...World.npcs].find(n => n.type === at.type && n.level === at.level && n.x === at.x && n.z === at.z);
  assert(npc, `full packed map loads original leprechaun ${at.file} ${at.x},${at.z}`);
  return npc;
});
function fixture() { const p = player(); exchange(p, actors[0]); return p; }
function restore(saved) {
  const p = player(saved);
  // PlayerLoading restores a real name hash; use World.getPlayerByUid's real
  // hash/slot identity instead of the shared fixture's hash-zero serial UID.
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | p.pid) >>> 0;
  p.invStopListenOnCom(com('inventory:inv'));
  p.invListenOnCom(inv, com('inventory:inv'), p.uid);
  return p;
}
function finish(p, script, npc, choices = []) {
  const state = Runner.init(script, p, npc);
  p.executeScript(state, true, true);
  for (let n = 0; state.execution !== State.FINISHED && n < 200; n++) {
    if (state.execution === State.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil); p.delayed = false;
    } else {
      assert.equal(state.execution, State.PAUSEBUTTON);
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) {
        assert(choices.length, `expected a choice for ${root}`);
        p.lastCom = com(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(p.lastCom));
      }
    }
    p.executeScript(state, true, true);
  }
  assert.equal(state.execution, State.FINISHED);
  assert.equal(choices.length, 0);
}
test('original cache varbits, exact limits and original interface count readers agree', () => {
  for (let i = 0; i < toolNames.length; i++) {
    const bit = types.VarBitType.get(id('VarBitType', `farming_tools_${suffix[i]}`));
    assert.equal(bit.basevar, storage); assert.equal(bit.startbit, bits[i][0]); assert.equal(bit.endbit, bits[i][1]);
    const maxText = types.Component.get(com(`tool_leprechaun:com_${72 + i * 3}`)).text;
    assert.equal(maxText, `Max: ${maxima[i]}`);
  }
  const magic = types.VarBitType.get(id('VarBitType', 'farming_tools_fairysecateurs'));
  assert.equal(magic.basevar, storage); assert.equal(magic.startbit, 30); assert.equal(magic.endbit, 30);
});
test('original packed main and side programs display the transferred counts and watering dose', () => {
  for (let i = 0; i < toolNames.length; i++) {
    const p = fixture(), main = `tool_leprechaun:com_${71 + i * 3}`, side = `tool_leprechaun_side:com_${3 + i * 2}`;
    assert.equal(clientText(p, main), '0'); assert.equal(clientText(p, side), '0');
    add(p, toolNames[i], 2); proc(p, 'farming_tools_refresh');
    assert.equal(clientText(p, side), '2');
    button(p, true, i);
    assert.equal(clientText(p, main), '1'); assert.equal(clientText(p, side), '1');
    button(p, false, i);
    assert.equal(clientText(p, main), '0'); assert.equal(clientText(p, side), '2');
    p.unlink();
  }
  const p = fixture();
  add(p, 'watering_can_8'); proc(p, 'farming_tools_refresh'); button(p, true, 4);
  assert.equal(clientText(p, 'tool_leprechaun:com_82'), 'Watering Can (8)');
  assert.equal(clientText(p, 'tool_leprechaun:com_83'), '1');
  button(p, false, 4); assert.equal(clientText(p, 'tool_leprechaun:com_82'), 'Watering Can');
  add(p, 'secateurs'); add(p, 'fairy_enchanted_secateurs');
  assert.equal(clientText(p, 'tool_leprechaun_side:com_9'), '2');
  p.unlink();
});
for (const [index, npc] of actors.entries()) test(`original placement ${index + 1}: shared Exchange and Talk dispatch`, () => {
  for (const trigger of [Trigger.OPNPC1, Trigger.OPNPC3]) {
    const p = player(); exchange(p, npc, trigger); p.unlink();
  }
});
for (let i = 0; i < toolNames.length; i++) test(`${toolNames[i]}: deposit, exact capacity, refusal, withdraw and empty refusal`, () => {
  const p = fixture();
  // High bit is outside every tool field. No transfer may clear it.
  p.setVar(storage, -2147483648);
  for (let n = 0; n < maxima[i]; n += 28) {
    const amount = Math.min(28, maxima[i] - n);
    add(p, toolNames[i], amount); button(p, true, i, i < 6 ? 1 : 3);
    assert.equal(stored(p, i), n + amount); assert.equal(count(p, toolNames[i]), 0);
  }
  add(p, toolNames[i]); const full = p.getVar(storage);
  button(p, true, i);
  assert.equal(p.getVar(storage), full); assert.equal(count(p, toolNames[i]), 1);
  assert(p.messages.includes('The leprechaun cannot store any more of that item.'));
  p.invDel(inv, obj(toolNames[i]), 1);
  let left = maxima[i];
  while (left) {
    button(p, false, i, i < 6 ? 1 : 3);
    const taken = Math.min(28, left); left -= taken;
    assert.equal(stored(p, i), left); assert.equal(count(p, toolNames[i]), taken);
    p.invDel(inv, obj(toolNames[i]), taken);
  }
  const empty = p.getVar(storage); button(p, false, i);
  assert.equal(p.getVar(storage), empty);
  assert(p.messages.includes('The leprechaun has none of that item stored.'));
  assert.equal(p.getVar(storage) >>> 31, 1);
  p.unlink();
});
for (let water = 0; water <= 8; water++) test(`watering can (${water}): original charge-plus-one survives custody and save/load`, () => {
  const p = fixture(); add(p, `watering_can_${water}`); proc(p, 'farming_tools_refresh');
  button(p, true, 4); assert.equal(field(p, 4), water + 1);
  const q = restore(p.save()); exchange(q, actors.at(-1));
  assert.equal(field(q, 4), water + 1); button(q, false, 4);
  assert.equal(count(q, `watering_can_${water}`), 1); assert.equal(field(q, 4), 0);
  p.unlink(); q.unlink();
});
test('normal OR magic secateurs occupy one slot and preserve identity after relog', () => {
  for (const first of ['secateurs', 'fairy_enchanted_secateurs']) {
    const other = first === 'secateurs' ? 'fairy_enchanted_secateurs' : 'secateurs';
    const p = fixture(); add(p, first); proc(p, 'farming_tools_refresh'); button(p, true, 3);
    assert.equal(field(p, 3), 1); assert.equal((p.getVar(storage) >>> 30) & 1, first === 'secateurs' ? 0 : 1);
    add(p, other); proc(p, 'farming_tools_refresh'); button(p, true, 3);
    assert.equal(count(p, other), 1); assert.equal(field(p, 3), 1);
    const q = restore(p.save()); exchange(q, actors.at(-1)); button(q, false, 3);
    assert.equal(count(q, first), 1); assert.equal(count(q, other), 1); assert.equal(field(q, 3), 0);
    assert.equal((q.getVar(storage) >>> 30) & 1, 0);
    p.unlink(); q.unlink();
  }
});
for (let i = 6; i < 9; i++) test(`${toolNames[i]}: Store/Remove 1, 5, All and X use native count replies`, () => {
  const p = fixture(); add(p, toolNames[i], 20);
  button(p, true, i, 1); assert.equal(stored(p, i), 1);
  button(p, true, i, 2); assert.equal(stored(p, i), 6);
  button(p, true, i, 4, 4); assert.equal(stored(p, i), 10);
  button(p, true, i, 3); assert.equal(stored(p, i), 20);
  button(p, false, i, 1); assert.equal(stored(p, i), 19);
  button(p, false, i, 2); assert.equal(stored(p, i), 14);
  button(p, false, i, 4, 4); assert.equal(stored(p, i), 10);
  button(p, false, i, 3); assert.equal(stored(p, i), 0); assert.equal(count(p, toolNames[i]), 20);
  for (const invalid of [0, -1]) {
    button(p, true, i, 4, invalid); assert.equal(stored(p, i), 0); assert.equal(count(p, toolNames[i]), 20);
  }
  p.unlink();
});
test('full inventory refuses without dropping items; a partial withdrawal uses only free slots', () => {
  const p = fixture(); add(p, 'bucket_compost', 5); button(p, true, 7, 3);
  add(p, 'rake', 28); const before = p.getVar(storage);
  button(p, false, 7, 3); assert.equal(p.getVar(storage), before); assert.equal(count(p, 'bucket_compost'), 0);
  assert(p.messages.includes("You don't have enough inventory space."));
  p.invDel(inv, obj('rake'), 2); button(p, false, 7, 3);
  assert.equal(count(p, 'bucket_compost'), 2); assert.equal(stored(p, 7), 3);
  p.unlink();
});
test('wrong item and absent item refuse without changing custody or inventory', () => {
  const p = fixture(); add(p, 'potato'); const before = p.getVar(storage);
  const type = types.NpcType.get(actors[0].type);
  const script = Scripts.getByTrigger(Trigger.OPNPCU, type.id, type.category);
  assert.equal(script?.name, '[opnpcu,farming_tools_leprechaun]');
  finish(p, script, actors[0]);
  assert.equal(count(p, 'potato'), 1); assert.equal(p.getVar(storage), before);
  button(p, true, 0); assert.equal(p.getVar(storage), before);
  assert(p.messages.includes('You do not have that item to store.'));
  p.unlink();
});
test('all fields survive real player serialization and another leprechaun; stores are per-player', () => {
  const p = fixture();
  for (let i = 0; i < toolNames.length; i++) { add(p, toolNames[i], i < 6 ? 1 : 9); button(p, true, i, i < 6 ? 1 : 3); }
  const before = p.getVar(storage); const q = restore(p.save()), stranger = fixture();
  assert.equal(stranger.getVar(storage), 0);
  exchange(q, actors.at(-1)); assert.equal(q.getVar(storage), before);
  for (let i = 0; i < toolNames.length; i++) {
    button(q, false, i, i < 6 ? 1 : 3);
    assert.equal(count(q, toolNames[i]), i < 6 ? 1 : 9);
    // Clear the verified output before the next category: the combined stored
    // set exceeds the player's ordinary 28-slot inventory.
    q.invDel(inv, obj(toolNames[i]), i < 6 ? 1 : 9);
  }
  assert.equal(q.getVar(storage), 0); p.unlink(); q.unlink(); stranger.unlink();
});
test('Fairytale I replacement counts stored magic, but still replaces a genuinely lost pair', () => {
  const script = Scripts.getByName('[opnpc1,elemental_wizard_boss]'); assert(script);
  const npc = [...World.npcs].find(n => n.type === id('NpcType', 'elemental_wizard_boss')); assert(npc);
  const stage = id('VarBitType', 'fairy_farmers_quest');
  for (const held of ['stored', 'lost']) {
    const p = fixture(); p.setVarBit(stage, 40); add(p, 'coins', 40001);
    if (held === 'stored') { add(p, 'fairy_enchanted_secateurs'); proc(p, 'farming_tools_refresh'); button(p, true, 3); }
    finish(p, script, npc, held === 'lost' ? [1] : []);
    assert.equal(count(p, 'coins'), held === 'lost' ? 1 : 40001);
    assert.equal(count(p, 'fairy_enchanted_secateurs'), held === 'lost' ? 1 : 0);
    assert.equal((p.getVar(storage) >>> 30) & 1, held === 'stored' ? 1 : 0);
    p.unlink();
  }
});
console.log(`${checks} tool-leprechaun compiled checks passed; ${actors.length} original placements`);
process.exit(0);
