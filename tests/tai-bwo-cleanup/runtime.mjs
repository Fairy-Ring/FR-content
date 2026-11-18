import assert from 'node:assert/strict';
import { World, types, map, player, seed, id, execute, ServerTriggerType, ScriptProvider, engineModule, held } from '../swamp-caves/runtime.mjs';
export * from '../swamp-caves/runtime.mjs';
const resolveNpcType = (await engineModule('engine/entity/resolveNpcType.ts')).default;
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');

export const murcaily = [...World.npcs].find(n => n.baseType === id('NpcType', 'tbwcu_murcaily_multinpc'));
assert(murcaily, 'original Murcaily placement is packed');
export const home = [murcaily.level, murcaily.x, murcaily.z];
export function fixture(position = home, items = ['machette']) {
  const p = seed(player(), items);
  if (items.includes('machette')) assert(held(p, 'machette', 2), 'fixture wields its seeded machete');
  [p.level, p.x, p.z] = position;
  p.originX = p.x; p.originZ = p.z;
  p.setVar(id('VarPlayerType', 'junglepotion'), 12);
  execute('[proc,tbw_cleanup_enter]', p);
  return p;
}
export function get(p, name) {
  const bit = types.VarBitType.getId(name);
  return bit >= 0 ? p.getVarBit(bit) : p.getVar(id('VarPlayerType', name));
}
export function set(p, name, value) {
  const bit = types.VarBitType.getId(name);
  if (bit >= 0) p.setVarBit(bit, value);
  else p.setVar(id('VarPlayerType', name), value);
}
export function hack(p, loc) {
  const type = types.LocType.get(loc.type);
  const script = ScriptProvider.getByTrigger(ServerTriggerType.OPLOC4, type.id, type.category);
  assert(script, `Hack dispatch for ${type.debugname}`);
  return execute(script.name, p, [], { target: loc });
}
export function dispatchNpc(p, npc, option = 1) {
  const type = resolveNpcType(types.NpcType.get(npc.type), p);
  const script = ScriptProvider.getByTrigger(ServerTriggerType[`OPNPC${option}`], type.id, type.category);
  assert(script, `visible ${type.debugname} option ${option}`);
  const state = ScriptRunner.init(script, p, npc);
  p.executeScript(state, true, true);
  return state;
}

export function standAt(p, loc) {
  for (let dx = -1; dx <= loc.width; dx++) for (let dz = -1; dz <= loc.length; dz++) {
    const x = loc.x + dx, z = loc.z + dz;
    if (map.isMapBlocked(x, z, loc.level)) continue;
    p.level = loc.level; p.x = x; p.z = z;
    if (!p.inOperableDistance(loc)) continue;
    const route = Array.from(map.findPath(loc.level, home[1], home[2], x, z));
    if ((home[1] !== x || home[2] !== z) && !route.length) continue;
    const last = route.length ? CoordGrid.unpackCoord(route.at(-1)) : { x, z };
    if (last.x !== x || last.z !== z) continue;
    p.originX = x; p.originZ = z;
    return;
  }
  assert.fail('interaction stand must be walkable, operable and foot-reachable from original Murcaily');
}
