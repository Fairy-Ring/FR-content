import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
export const load = relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
export const World = (await load('engine/World.ts')).default;
export const Runner = (await load('engine/script/ScriptRunner.ts')).default;
export const Scripts = (await load('engine/script/ScriptProvider.ts')).default;
export const State = (await load('engine/script/ScriptState.ts')).default;
export const { ScriptOpcode } = await load('engine/script/ScriptOpcode.ts');
export const { PlayerTimerType } = await load('engine/entity/EntityTimer.ts');
export const { PlayerStat } = await load('engine/entity/PlayerStat.ts');
export const { NetworkPlayer } = await load('engine/entity/NetworkPlayer.ts');
export const { PlayerLoading } = await load('engine/entity/PlayerLoading.ts');
export const Packet = (await load('io/Packet.ts')).default;
export const JavaRandom = (await load('util/JavaRandom.ts')).default;
export const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  types[name] = (await load(`cache/config/${name}.ts`)).default;
  types[name].load(path.join(engine, 'data/pack'));
}
(await load('cache/config/DbTableIndex.ts')).default.init();
assert(Scripts.load(path.join(engine, 'data/pack')) > 0, 'build the complete sibling engine pack first');
World.currentTick = 100;
World.gameMap.init();
export function id(kind, name) {
  const value = types[kind].getId(name);
  assert(value >= 0, `missing packed ${kind} ${name}`);
  return value;
}
export const inv = id('InvType', 'inv');
const component = id('Component', 'inventory:inv');
const OpLocU = (await load('network/game/client/model/OpLocU.ts')).default;
const OpLoc = (await load('network/game/client/model/OpLoc.ts')).default;
const useHandler = new ((await load('network/game/client/handler/OpLocUHandler.ts')).default)();
const clickHandler = new ((await load('network/game/client/handler/OpLocHandler.ts')).default)();
let serial = 0;
export function player(saved = null) {
  const name = `farmtest${++serial}`;
  const p = saved ? PlayerLoading.load(name, new Packet(saved), null)
    : new NetworkPlayer(name, 0n, 0n, { uuid: name });
  p.pid = serial; p.uid = serial;
  p.x = 3049; p.z = 3307; p.level = 0; p.isActive = true;
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  p.write = () => {};
  p.messages = [];
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  p.tabs[3] = types.Component.get(component).rootLayer;
  p.invListenOnCom(inv, component, p.uid);
  World.players[p.pid] = p;
  return p;
}
export function run(p, name, args = []) {
  const script = Scripts.getByName(name);
  assert(script, `missing compiled ${name}`);
  const state = Runner.init(script, p, null, args);
  assert.equal(p.runScript(state, true, true), State.FINISHED, name);
  return state;
}
export const proc = (p, name, ...args) => run(p, `[proc,${name}]`, args);
export const add = (p, name, n = 1) => p.invAdd(inv, id('ObjType', name), n);
export const count = (p, name) => p.invTotal(inv, id('ObjType', name));
export function slot(p, name) {
  for (let i = 0; i < types.InvType.get(inv).size; i++) {
    if (p.invGetSlot(inv, i)?.id === id('ObjType', name)) return i;
  }
  assert.fail(`missing inventory ${name}`);
}
export function use(p, name, loc) {
  p.originX = p.x; p.originZ = p.z;
  const accepted = useHandler.handle(new OpLocU(loc.x, loc.z, loc.type, id('ObjType', name), slot(p, name), component), p);
  if (accepted) p.processInteraction();
  return accepted;
}
export function click(p, loc, option = 1) {
  p.originX = p.x; p.originZ = p.z;
  const accepted = clickHandler.handle(new OpLoc(option, loc.x, loc.z, loc.type), p);
  if (accepted) p.processInteraction();
  return accepted;
}
