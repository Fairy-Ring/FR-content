import assert from 'node:assert/strict';
import { player, run, result, draws, check, World, map, types, id, v, O, tile, environmentTick, engineModule, ServerTriggerType, advance, ScriptState, resumeDialogue, CollisionType } from './runtime.mjs';
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const lowWallNames = ['macro_maze_walllow', 'macro_maze_walllow_safe1', 'macro_maze_walllow_safe2', 'macro_maze_walllow_safe3', 'macor_maze_walllow_safe4'];
const directions = [0, 1, 2, 2, 1];
const pack = (x, z) => (x << 14) | z;
const unpack = key => [key >>> 14, key & 0x3fff];
const coord = (level, x, z) => (level << 28) | pack(x, z);
const within = (x, z) => x >= 2880 && x < 2944 && z >= 4544 && z < 4608;
const idle = p => { environmentTick(p); World.processZones(); World.processCleanup(); };
function operate(p, loc) {
  assert(p.setInteraction(Interaction.ENGINE, loc, ServerTriggerType.APLOC1));
  assert(p.tryInteract(true), 'real native location operation is in reach');
  const state = p.activeScript;
  if (state) advance(p, state);
  assert.notEqual(p.activeScript?.execution, ScriptState.PAUSEBUTTON, 'planned door side is not a wrong-way refusal');
}
function mazeLocations() {
  const rows = [], shrineType = id('LocType', 'macro_maze_complete');
  let shrine;
  for (let x = 2880; x < 2944; x++) for (let z = 4544; z < 4608; z++) {
    shrine ??= World.getLoc(x, z, 0, shrineType);
    for (const name of lowWallNames) {
      const loc = World.getLoc(x, z, 0, id('LocType', name));
      if (loc) rows.push({ loc, name });
    }
  }
  assert(shrine && rows.length > 0, 'native maze supplies walls and central shrine');
  return { rows, shrine };
}
function plan(p, rows, shrine) {
  const doors = new Map(), approachParam = id('ParamType', 'approach_direction');
  for (const { loc, name } of rows) {
    const config = types.LocType.get(loc.type), policy = config.params.get(approachParam);
    assert.equal(policy, directions[lowWallNames.indexOf(name)], 'independent finished-donor direction binding');
    assert.equal(config.category, id('CategoryType', 'macro_maze_wall_door'));
    const vector = run(p, '[proc,door_open]', [loc.angle, loc.shape]);
    const dx = vector.intStack[vector.isp - 2], dz = vector.intStack[vector.isp - 1];
    const a = pack(loc.x, loc.z), b = pack(loc.x + dx, loc.z + dz);
    for (const [from, to] of [[a,b], [b,a]]) {
      const [x,z] = unpack(from);
      const side = result(run(p, '[proc,check_axis]', [coord(0,x,z), coord(0,loc.x,loc.z), loc.angle]));
      if (policy !== 0 && !(policy === 1 && side === 1) && !(policy === 2 && side === 0)) continue;
      const entries = doors.get(from) ?? []; entries.push({ to, loc }); doors.set(from, entries);
    }
  }
  const start = pack(p.x,p.z), queue = [start], parents = new Map([[start, null]]);
  const shrineConfig = types.LocType.get(shrine.type);
  let goal;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index], [x,z] = unpack(current);
    if (map.reachedLoc(0,x,z,shrine.x,shrine.z,shrineConfig.width,shrineConfig.length,1,shrine.angle,shrine.shape,shrineConfig.forceapproach)) { goal = current; break; }
    const edges = [...(doors.get(current) ?? [])];
    for (const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, nz = z + dz;
      if (within(nx,nz) && map.canTravel(0,x,z,dx,dz,1,0,CollisionType.NORMAL)) edges.push({ to: pack(nx,nz), loc: null });
    }
    for (const edge of edges) {
      const [nx,nz] = unpack(edge.to);
      if (!within(nx,nz) || parents.has(edge.to)) continue;
      parents.set(edge.to, { from: current, ...edge }); queue.push(edge.to);
    }
  }
  assert.notEqual(goal, undefined, 'native collision and sourced one-way doors connect this actual entrance to the shrine');
  const route = [];
  for (let current = goal; current !== start;) { const edge = parents.get(current); route.push(edge); current = edge.from; }
  return route.reverse();
}
for (let entrance = 0; entrance < 4; entrance++) check(`Maze entrance ${entrance} walks its entire native route and crosses real doors to the shrine`, () => {
  // Finish any previous temporary native door lifecycle before the next independent route.
  for (let n = 0; n < 4; n++) { World.currentTick++; World.processZones(); World.processCleanup(); }
  const p = player();
  draws({ '[proc,macro_maze_start]': [entrance] }, () => run(p, '[proc,macro_event_general_spawn]', [20]));
  assert.equal(p.getVar(v('macro_event')), 20);
  const { rows, shrine } = mazeLocations(), route = plan(p, rows, shrine);
  let crossings = 0, walked = 0;
  for (const step of route) {
    const [x,z] = unpack(step.to);
    if (step.loc) {
      const loc = World.getLoc(step.loc.x, step.loc.z, 0, step.loc.type);
      assert(loc, 'planned native door still exists'); operate(p, loc); crossings++;
    } else {
      p.originX = p.x; p.originZ = p.z;
      assert(moveHandler.handle(new MoveClick([{ x,z }], 0, false), p), 'real MoveClick accepts the next collision-proven step');
      for (let n = 0; (p.x !== x || p.z !== z) && n < 4; n++) idle(p);
      walked++;
    }
    assert.deepEqual(tile(p), [0,x,z], 'native movement or compiled door traversal reaches the planned tile');
  }
  assert(crossings > 0 && walked > 0, 'completion is neither a direct shrine teleport nor a script-only return');
  const potential = p.getVar(v('macro_transmit'));
  operate(p, shrine);
  assert.equal(p.getVar(v('macro_event')), 0); assert.deepEqual(tile(p), O);
  console.log(JSON.stringify({ entrance, walked, crossings, potential }));
});
console.log('All four complete native Maze routes passed');
// Native World imports own workers; every assertion above is synchronous and complete.
process.exit(0);
