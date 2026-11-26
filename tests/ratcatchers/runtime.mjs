import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  World, Player, Npc, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType,
  EntityLifeCycle, BlockWalk, types, map, floorTiles, nativeNpcRows, nativeLocRows,
  locFor, engine, requiredId, ResumePauseButtonHandler, ResumePauseButton, InvButtonHandler, InvButton
} from '../regicide-travel/runtime.mjs';
export {
  World, Npc, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType,
  EntityLifeCycle, BlockWalk, types, map, floorTiles, nativeNpcRows, nativeLocRows, locFor, engine
};
export const load = async file => import(pathToFileURL(path.join(engine, 'src', file)).href);
const JavaRandom = (await load('util/JavaRandom.ts')).default;
export function withRandom(value, fn) {
  const previous = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => value;
  try { return fn(); }
  finally { JavaRandom.nextDouble = previous; }
}
const IfButton = (await load('network/game/client/model/IfButton.ts')).default;
const buttons = new (await load('network/game/client/handler/IfButtonHandler.ts')).default();
const pauses = new ResumePauseButtonHandler();
const invButtons = new InvButtonHandler();
const OpHeld = (await load('network/game/client/model/OpHeld.ts')).default;
const OpHeldU = (await load('network/game/client/model/OpHeldU.ts')).default;
const heldHandler = new (await load('network/game/client/handler/OpHeldHandler.ts')).default();
const useHandler = new (await load('network/game/client/handler/OpHeldUHandler.ts')).default();
World.vars = new Int32Array(types.VarSharedType.count);
export const id = (kind, name) => requiredId(types[kind], name);
export const obj = name => id('ObjType', name);
export const inv = id('InvType', 'inv'), worn = id('InvType', 'worn'), bank = id('InvType', 'bank');
export const v = name => id('VarPlayerType', name), b = name => id('VarBitType', name);
export const stage = p => p.getVarBit(b('ratcatch_var'));
export const count = (p, name, inventory = inv) => p.invTotal(inventory, obj(name));
export const add = (p, name, amount = 1, inventory = inv) => p.invAdd(inventory, obj(name), amount);
export const drop = (p, name, inventory = inv) => p.invDel(inventory, obj(name), count(p, name, inventory));
export const tile = p => [p.level, p.x, p.z];
const unpack = packed => [(packed >>> 14) & 0x3fff, packed & 0x3fff];
let serial = 0;
export function player({ qualified = true, cat = 'growncat' } = {}) {
  const n = ++serial;
  const p = new Player(`ratcase${n}`, BigInt(n), BigInt(n));
  p.pid = n; p.slot = n; p.uid = ((n << 11) | n) >>> 0;
  p.level = 0; p.x = 3150; p.z = 3412; p.isActive = true;
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(1000000);
  p.setVar(v('tutorial'), 1000); p.setVar(v('fluffs'), 6);
  p.setVarBit(b('ics_little_var'), qualified ? 26 : 0);
  p.setVar(v('follower_obj'), -1); p.setVar(v('follower_uid'), -1);
  p.packets = []; p.messages = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  World.players[n] = p; World.playerLoop.add(BigInt(n), p);
  for (const [inventory, component, tab] of [[inv, 'inventory:inv', 3], [worn, 'wornitems:worn', 4]]) {
    const com = id('Component', component);
    p.tabs[tab] = types.Component.get(com).rootLayer;
    p.invListenOnCom(inventory, com, p.uid);
  }
  if (cat) run(p, '[proc,cat_spawn]', [id('NpcType', cat)]);
  return p;
}
export function run(p, name, args = [], target = null, choices = []) {
  const script = ScriptProvider.getByName(name); assert(script, name);
  const state = ScriptRunner.init(script, p, target, args);
  p.executeScript(state, true, true);
  finish(p, state, choices);
  return state;
}
export function finish(p, state, choices = []) {
  const remaining = [...choices];
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 240; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'compiled script does not abort');
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false; p.executeScript(state, true, true);
    } else {
      assert.equal(state.execution, ScriptState.PAUSEBUTTON, `unexpected boundary ${state.execution}`);
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) {
        assert(remaining.length, `explicit choice required in ${root}`);
        assert(buttons.handle(new IfButton(id('Component', `${root}:com_${remaining.shift()}`)), p));
      } else if (root === 'pick_a_kitten') {
        assert(remaining.length, 'explicit kitten-picker slot required');
        const chosen = remaining.shift(), offered = p.getInventory(id('InvType', 'pickcatinv')).items[chosen];
        assert(offered, 'the selected kitten is actually offered');
        // The next input cycle clears the suspension lock in Player.resetEntity.
        World.currentTick++; p.protect = false;
        assert(invButtons.handle(new InvButton(1, offered.id, chosen, id('Component', 'pick_a_kitten:com_0')), p));
        // The picker action closes and replaces the paused NPC caller with its own script.
        if (p.activeScript) finish(p, p.activeScript, remaining);
        else assert.equal(remaining.length, 0, 'all choices were consumed by the native picker action');
        return;
      } else assert(pauses.handle(new ResumePauseButton(0), p));
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'interaction finishes');
  assert.equal(remaining.length, 0, 'all specified choices were offered');
}
export function button(p, name) {
  assert(buttons.handle(new IfButton(id('Component', name)), p), name);
  if (p.activeScript) finish(p, p.activeScript);
}
export function slot(p, name) {
  const value = p.getInventory(inv).items.findIndex(item => item?.id === obj(name));
  assert(value >= 0, `${name} is in inventory`);
  return value;
}
export function held(p, name, op = 1, choices = []) {
  assert(heldHandler.handle(new OpHeld(op, obj(name), slot(p, name), id('Component', 'inventory:inv')), p));
  if (p.activeScript) finish(p, p.activeScript, choices);
  else assert.equal(choices.length, 0);
}
export function useItems(p, used, target, choices = []) {
  const com = id('Component', 'inventory:inv');
  assert(useHandler.handle(new OpHeldU(obj(target), slot(p, target), com, obj(used), slot(p, used), com), p));
  if (p.activeScript) finish(p, p.activeScript, choices);
  else assert.equal(choices.length, 0);
}
export function cat(p) {
  for (const npc of World.npcs) if (npc.uid === p.getVar(v('follower_uid'))) return npc;
  assert.fail('the owned follower is a real world NPC');
}
export function escape(at, label) {
  const [level, x, z] = at;
  assert(floorTiles.has(at.join(',')), `${label}: original map has a floor`);
  assert(!map.isMapBlocked(x, z, level), `${label}: walkable arrival`);
  for (let radius = 2; radius <= 12; radius++) {
    for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      const tx = x + dx, tz = z + dz;
      if (map.isMapBlocked(tx, tz, level)) continue;
      const route = map.findPath(level, x, z, tx, tz);
      if (route.length && unpack(route.at(-1)).join() === [tx, tz].join()) return;
    }
  }
  assert.fail(`${label}: no nonempty exact findPath route out`);
}
export function target(kind, name, select = rows => rows[0]) {
  const rows = kind === 'npc' ? nativeNpcRows(name) : nativeLocRows(name);
  assert(rows.length, `native map places ${name}`);
  const row = select(rows); assert(row, `required native ${name} placement`);
  const entity = kind === 'loc' ? locFor(row) : new Npc(row.level, row.x, row.z, 1, 1,
    EntityLifeCycle.RESPAWN, World.getNextNid(), row.id, BlockWalk.NONE);
  entity.isActive = true;
  const type = types[kind === 'npc' ? 'NpcType' : 'LocType'].get(row.id);
  for (let radius = 2; radius <= 12; radius++) {
    for (let x = row.x - radius; x <= row.x + radius; x++) for (let z = row.z - radius; z <= row.z + radius; z++) {
      if (!floorTiles.has(`${row.level},${x},${z}`) || map.isMapBlocked(x, z, row.level)) continue;
      const route = kind === 'npc'
        ? map.findPathToEntity(row.level, x, z, row.x, row.z, 1, type.size, type.size)
        : map.findPathToLoc(row.level, x, z, row.x, row.z, 1, type.width, type.length, row.angle, row.shape, type.forceapproach);
      if (!route.length) continue;
      const stand = unpack(route.at(-1));
      const reached = kind === 'npc'
        ? map.reachedEntity(row.level, ...stand, row.x, row.z, type.size, type.size, 1)
        : map.reachedLoc(row.level, ...stand, row.x, row.z, type.width, type.length, 1, row.angle, row.shape, type.forceapproach);
      if (reached && !map.isMapBlocked(...stand, row.level)) return { entity, stand: [row.level, ...stand], row };
    }
  }
  assert.fail(`no real packed-map approach to ${name}`);
}
export function interact(p, fixture, trigger, item = null, choices = []) {
  p.closeModal(); [p.level, p.x, p.z] = fixture.stand; p.originX = p.x; p.originZ = p.z;
  p.target = fixture.entity; p.targetOp = trigger - 7;
  if (item) p.lastUseItem = obj(item);
  const script = p.getOpTrigger(); assert(script, 'production visible-form dispatch');
  const state = ScriptRunner.init(script, p, fixture.entity);
  p.executeScript(state, true, true); finish(p, state, choices);
  return script.name;
}
export function fill(p) { while (p.invFreeSpace(inv) > 0) add(p, 'bronze_dagger'); }
export function makeSpace(p, n = 28) { p.invDel(inv, obj('bronze_dagger'), n); }
export const points = p => run(p, '[proc,count_questpoints]').popInt();
