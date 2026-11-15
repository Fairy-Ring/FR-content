import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine');
const load = async relative => import(pathToFileURL(path.join(engineRoot, 'src', relative)).href);
const defaultExport = async relative => (await load(relative)).default;
export const World = await defaultExport('engine/World.ts');
export const Player = await defaultExport('engine/entity/Player.ts');
export const Packet = await defaultExport('io/Packet.ts');
export const { PlayerLoading } = await load('engine/entity/PlayerLoading.ts');
export const ScriptProvider = await defaultExport('engine/script/ScriptProvider.ts');
const ScriptRunner = await defaultExport('engine/script/ScriptRunner.ts');
export const ScriptState = await defaultExport('engine/script/ScriptState.ts');
export const ServerTriggerType = await defaultExport('engine/script/ServerTriggerType.ts');
export const { PlayerStat } = await load('engine/entity/PlayerStat.ts');
export const map = await load('engine/GameMap.ts');
export const types = {};
export const { CollisionType } = await load('engine/routefinder/index.ts');
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  types[name] = await defaultExport(`cache/config/${name}.ts`);
  types[name].load(path.join(engineRoot, 'data/pack'));
}
(await defaultExport('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load(path.join(engineRoot, 'data/pack')) > 0, 'build the sibling engine first');
assert.equal((await defaultExport('util/Environment.ts')).NODE_MEMBERS, true, 'real members-world configs required');
World.currentTick = 100;
World.gameMap.init();

const OpHeldU = await defaultExport('network/game/client/model/OpHeldU.ts');
const OpHeld = await defaultExport('network/game/client/model/OpHeld.ts');
const InvButton = await defaultExport('network/game/client/model/InvButton.ts');
const useHandler = new (await defaultExport('network/game/client/handler/OpHeldUHandler.ts'))();
const heldHandler = new (await defaultExport('network/game/client/handler/OpHeldHandler.ts'))();
const removeHandler = new (await defaultExport('network/game/client/handler/InvButtonHandler.ts'))();
const ResumePauseButton = await defaultExport('network/game/client/model/ResumePauseButton.ts');
const IfButton = await defaultExport('network/game/client/model/IfButton.ts');
const pauseHandler = new (await defaultExport('network/game/client/handler/ResumePauseButtonHandler.ts'))();
const buttonHandler = new (await defaultExport('network/game/client/handler/IfButtonHandler.ts'))();
export function id(kind, name) {
  const value = types[kind].getId(name);
  assert(value >= 0, `missing packed ${kind} ${name}`);
  return value;
}
export const obj = name => id('ObjType', name);
export const inv = id('InvType', 'inv');
export const worn = id('InvType', 'worn');
export const invCom = id('Component', 'inventory:inv');
export const wornCom = id('Component', 'wornitems:worn');
let serial = 0;
export function player(firemaking = 99) {
  const slot = ++serial;
  const hash = BigInt(slot);
  const p = new Player(`swamp${slot}`, hash, hash);
  p.pid = slot; p.slot = slot;
  p.uid = ((slot << 11) | slot) >>> 0;
  p.level = 0; p.x = 3170; p.z = 3173;
  p.isActive = true;
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(123456);
  p.baseLevels[PlayerStat.FIREMAKING] = firemaking;
  p.levels[PlayerStat.FIREMAKING] = firemaking;
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  p.messages = []; p.packets = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  World.players[slot] = p;
  World.playerLoop.add(hash, p);
  p.tabs[3] = types.Component.get(invCom).rootLayer;
  p.tabs[4] = types.Component.get(wornCom).rootLayer;
  p.invListenOnCom(inv, invCom, p.uid);
  p.invListenOnCom(worn, wornCom, p.uid);
  return p;
}
export function seed(p, names) {
  for (const name of names) p.invAdd(inv, obj(name), 1);
  return p;
}
export function inventory(p, which = inv) {
  return Array.from({ length: types.InvType.get(which).size }, (_, slot) => {
    const item = p.invGetSlot(which, slot);
    return item ? { name: types.ObjType.get(item.id).debugname, count: item.count } : null;
  });
}
export const count = (p, name, which = inv) => p.invTotal(which, obj(name));
export function slotOf(p, name, which = inv) {
  const slot = inventory(p, which).findIndex(item => item?.name === name);
  assert(slot >= 0, `${name} must be in ${which === inv ? 'inventory' : 'worn items'}`);
  return slot;
}
export function use(p, useName, targetName, { useSlot = slotOf(p, useName), targetSlot = slotOf(p, targetName) } = {}) {
  return useHandler.handle(new OpHeldU(obj(targetName), targetSlot, invCom, obj(useName), useSlot, invCom), p);
}
export function held(p, name, option, slot = slotOf(p, name)) {
  return heldHandler.handle(new OpHeld(option, obj(name), slot, invCom), p);
}
export function remove(p, name) {
  return removeHandler.handle(new InvButton(1, obj(name), slotOf(p, name, worn), wornCom), p);
}
export function execute(name, p, args = [], { allowPause = false, target = null } = {}) {
  const script = ScriptProvider.getByName(name);
  assert(script, `missing packed script ${name}`);
  const state = ScriptRunner.init(script, p, target, args);
  let execution = p.runScript(state, true, true);
  for (let boundary = 0; execution === ScriptState.SUSPENDED && boundary < 40; boundary++) {
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    p.delayed = false;
    execution = p.runScript(state, true, true);
  }
  assert(execution === ScriptState.FINISHED || (allowPause && execution === ScriptState.PAUSEBUTTON), `${name} execution=${execution}`);
  return state;
}
export const tile = p => [p.level, p.x, p.z];

// Dialogue uses the production pause/choice handlers. Existing delay-only
// execute() semantics remain unchanged for SC-01.
export function startDialogue(name, p, target = null) {
  const script = ScriptProvider.getByName(name);
  assert(script, `missing packed script ${name}`);
  p.dialogueMark = p.packets.length;
  const state = ScriptRunner.init(script, p, target);
  p.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, `${name} opens dialogue`);
  return state;
}
export function resumeDialogue(p, option = null) {
  const state = p.activeScript;
  assert.equal(state?.execution, ScriptState.PAUSEBUTTON, 'real dialogue is paused');
  p.dialogueMark = p.packets.length;
  if (option === null) {
    assert(!/^multi[2-5]$/.test(types.Component.get(p.modalChat).comName), 'a choice must be selected explicitly');
    assert(pauseHandler.handle(new ResumePauseButton(0), p), 'Continue accepted');
  } else {
    const root = types.Component.get(p.modalChat).comName;
    assert(/^multi[2-5]$/.test(root), `not a dialogue choice: ${root}`);
    const component = id('Component', `${root}:com_${option}`);
    assert(p.resumeButtons.includes(component), `offered ${root} option ${option}`);
    assert(buttonHandler.handle(new IfButton(component), p), 'choice accepted');
  }
  assert.notEqual(state.execution, ScriptState.ABORTED, 'dialogue must not abort');
  return state;
}
export function dialoguePage(p) {
  return p.packets.slice(p.dialogueMark)
    .filter(packet => packet.constructor.name === 'IfSetText')
    .map(packet => packet.text.replaceAll('|', ' ').replace(/\s+/g, ' ').trim());
}
