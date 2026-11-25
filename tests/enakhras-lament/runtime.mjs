import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, ScriptState, ServerTriggerType, map, contentRoot, engineModule,
  id, obj, inv, count, types, player, resumeDialogue
} from '../swamp-caves/runtime.mjs';
export * from '../swamp-caves/runtime.mjs';
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.js');
const { BlockWalk } = await engineModule('engine/entity/BlockWalk.js');
export const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
export const { Interaction } = await engineModule('engine/entity/Interaction.js');
export const placements = [];
for (const file of ['m48_145.jm2', 'm49_45.jm2']) {
  const [mx, mz] = file.slice(1).split('_').map(Number.parseFloat);
  let kind;
  for (const line of fs.readFileSync(path.join(contentRoot, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) kind = line.includes('LOC') ? 'LocType' : line.includes('NPC') ? 'NpcType' : null;
    if (!kind) continue;
    const match = /^(\d+) (\d+) (\d+): (\d+)(?: (\d+)(?: (\d+))?)?/.exec(line);
    if (!match) continue;
    const [, level, x, z, type] = match.map(Number);
    const shape = Number(match[5] ?? 10), angle = Number(match[6] ?? 0);
    placements.push({ kind, level, x: mx * 64 + x, z: mz * 64 + z, type, shape, angle });
  }
}
export const value = (p, name) => p.getVarBit(id('VarBitType', name));
export const set = (p, name, n) => p.setVarBit(id('VarBitType', name), n);
export const stage = p => value(p, 'enakh_quest');
export function loc(name, index = 0) {
  const rows = placements.filter(row => row.kind === 'LocType' && row.type === id('LocType', name));
  const row = rows[index];
  assert(row, `original ${name} placement ${index}`);
  const target = World.getLoc(row.x, row.z, row.level, row.type);
  assert(target, `${name} exists on the packed map`);
  return target;
}
let serial = 10000;
export function npc(name) {
  const row = placements.find(row => row.kind === 'NpcType' && row.type === id('NpcType', name));
  assert(row, `original ${name} NPC placement`);
  const size = types.NpcType.get(row.type).size;
  const actor = new Npc(row.level, row.x, row.z, size, size, EntityLifeCycle.RESPAWN, serial++, row.type, BlockWalk.NONE);
  actor.isActive = true;
  actor.lastMovement = -100;
  return actor;
}
export function approach(target) {
  const isNpc = target instanceof Npc;
  const type = types[isNpc ? 'NpcType' : 'LocType'].get(target.type);
  for (let radius = 1; radius <= 3; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      const x = target.x + dx, z = target.z + dz;
      if (map.isMapBlocked(x, z, target.level)) continue;
      const reached = isNpc
        ? map.reachedEntity(target.level, x, z, target.x, target.z, type.size, type.size, 1)
        : map.reachedLoc(target.level, x, z, target.x, target.z, type.width, type.length, 1, target.angle, target.shape, type.forceapproach);
      if (reached) return { level: target.level, x, z };
    }
  }
  assert.fail(`${type.debugname} at ${target.level}:${target.x},${target.z} has no packed approach`);
}
export function stand(p, target) {
  const tile = approach(target);
  assert.equal(map.isMapBlocked(tile.x, tile.z, tile.level), false, 'target approach is walkable');
  Object.assign(p, tile, { originX: tile.x, originZ: tile.z });
  return tile;
}
export function finish(p, state, choices = []) {
  const rest = [...choices];
  for (let steps = 0; state.execution !== ScriptState.FINISHED && steps < 180; steps++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} does not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const component = types.Component.get(p.modalChat);
      if (/^multi[2-5]$/.test(component?.comName ?? '')) {
        assert(rest.length, `explicit choice needed for ${state.script.name}`);
        resumeDialogue(p, rest.shift());
      } else resumeDialogue(p);
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else assert.fail(`${state.script.name}: unexpected execution ${state.execution}`);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${state.script.name} finishes`);
  assert.equal(rest.length, 0, 'all supplied choices consumed');
  return state;
}
export function dispatch(p, target, trigger, choices = [], item = null) {
  p.target = target;
  p.targetOp = trigger - 7;
  if (item) {
    assert(count(p, item) > 0, `${item} is really held`);
    p.lastUseItem = obj(item);
  }
  const script = p.getOpTrigger();
  assert(script, `${types[target instanceof Npc ? 'NpcType' : 'LocType'].get(target.type).debugname}: production visible-form dispatch ${trigger}`);
  const state = ScriptRunner.init(script, p, target);
  p.executeScript(state, true, true);
  return finish(p, state, choices);
}
export const talk = (p, name, choices = []) => dispatch(p, npc(name), ServerTriggerType.OPNPC1, choices);
export const click = (p, target, choices = []) => dispatch(p, target, ServerTriggerType.OPLOC1, choices);
export const useOn = (p, item, target, choices = []) => dispatch(p, target, target instanceof Npc ? ServerTriggerType.OPNPCU : ServerTriggerType.OPLOCU, choices, item);
export function qualified(stageValue = 0) {
  const p = player();
  p.stats.fill(130344310); // Consistent 99-level XP in tenths, including after gains.
  set(p, 'enakh_quest', stageValue);
  return p;
}
export function random(values, action) {
  const original = JavaRandom.nextDouble;
  let used = 0;
  JavaRandom.nextDouble = () => { assert(used < values.length, 'bounded expected quarry random draws'); return values[used++]; };
  try { const result = action(); assert.equal(used, values.length, 'exact quarry random draws'); return result; }
  finally { JavaRandom.nextDouble = original; }
}
export function remove(p, name, which = inv) {
  const container = p.getInventory(which);
  for (let slot = 0; slot < container.capacity; slot++) {
    if (p.invGetSlot(which, slot)?.id !== obj(name)) continue;
    container.set(slot, null);
    return;
  }
  assert.fail(`${name} exists for the loss fixture`);
}
