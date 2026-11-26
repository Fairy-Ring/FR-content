import assert from 'node:assert/strict';
import { advance, check, count, draws, Environment, id, inventory, map, O, player, resumeDialogue, result, run, ScriptState, ServerTriggerType, tile, types, v, World, environmentTick, engineModule } from './runtime.mjs';

const event = 20;
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
function startMaze() {
  const p = player();
  draws({ '[proc,macro_maze_start]': [0] }, () => run(p, '[proc,macro_event_general_spawn]', [event]));
  assert.equal(p.getVar(v('macro_event')), event);
  assert.equal(p.getVar(v('macro_event_origin_coord')), (O[0] << 28) | (O[1] << 14) | O[2]);
  assert.deepEqual(tile(p), [0, 2891, 4597]);
  assert.equal(p.getVar(v('macro_transmit')), 100);
  assert.equal(p.getVar(v('xplamp')), 100);
  return p;
}
function findMazeLoc(names) {
  const minX = 45 * 64, minZ = 71 * 64;
  for (const name of names) {
    const type = types.LocType.getId(name);
    if (type < 0) continue;
    for (let level = 0; level < 4; level++) {
      for (let x = minX; x < minX + 64; x++) {
        for (let z = minZ; z < minZ + 64; z++) {
          const loc = World.getLoc(x, z, level, type);
          if (loc) return { name, loc };
        }
      }
    }
  }
  assert.fail(`no native Maze location found: ${names.join(', ')}`);
}
function position(p, level, x, z) {
  p.level = level; p.x = x; p.z = z;
  p.buildArea.originX = Math.floor(x / 8) * 8;
  p.buildArea.originZ = Math.floor(z / 8) * 8;
  p.originX = x; p.originZ = z;
}
function settleMessage(p) {
  const state = p.activeScript;
  if (state?.execution === ScriptState.PAUSEBUTTON) {
    resumeDialogue(p);
    if (state.execution === ScriptState.SUSPENDED) advance(p, state);
  }
}
function interact(p, loc) {
  assert(p.setInteraction(Interaction.ENGINE, loc, ServerTriggerType.APLOC1), 'player accepts native location interaction');
  const script = p.getOpTrigger();
  assert(script, 'native location operation resolves');
  assert(p.tryInteract(true), 'player executes native location operation');
  const state = p.activeScript;
  if (state) advance(p, state);
  return script;
}
function leaveMaze(p) { run(p, '[proc,macro_arena_return]', [event]); }

check('Maze start preserves exact origin and selects a native entrance', () => {
  const p = startMaze();
  assert.equal(p.getVar(v('macro_arena_clock')), World.currentTick);
  leaveMaze(p);
});

check('Maze softtimer reaches the 400-tick endpoint while a modal loot message is open', () => {
  const p = startMaze();
  run(p, '[proc,mesbox]', ['A chest is open.']);
  assert.equal(p.activeScript?.execution, ScriptState.PAUSEBUTTON);
  for (let n = 0; n < 399; n++) environmentTick(p);
  assert.equal(p.getVar(v('macro_transmit')), 1);
  assert.equal(p.getVar(v('xplamp')), 100, 'softtimer does not write protected xplamp');
  environmentTick(p);
  assert.equal(p.getVar(v('macro_transmit')), 0);
  assert.equal(p.getVar(v('macro_event')), event, 'zero potential does not eject');
  assert.deepEqual(tile(p), [0, 2891, 4597]);
  settleMessage(p);
  run(p, '[proc,macro_maze_refresh]');
  assert.equal(p.getVar(v('xplamp')), 0, 'protected action settles elapsed wall-clock time');
  leaveMaze(p);
});

check('Maze logout settles pending decay and login pauses offline time', () => {
  const p = startMaze();
  run(p, '[proc,mesbox]', ['A chest is open.']);
  for (let n = 0; n < 399; n++) environmentTick(p);
  assert.equal(p.getVar(v('macro_transmit')), 1);
  run(p, '[proc,macro_event_logout]');
  assert.equal(p.getVar(v('macro_transmit')), 1);
  p.closeModal(); p.timers.clear();
  World.currentTick += 1000;
  run(p, '[queue,macro_event_login]');
  assert.equal(p.getVar(v('macro_event')), event);
  assert.equal(p.getVar(v('macro_transmit')), 1, 'offline time is not charged');
  assert.equal(p.getVar(v('xplamp')), 1);
  assert.equal(p.getVar(v('macro_arena_clock')), World.currentTick);
  for (let n = 0; n < 4; n++) environmentTick(p);
  assert.equal(p.getVar(v('macro_transmit')), 0);
  leaveMaze(p);
});

check('Maze chest member and free rolls use the native compiled reward table; zero potential is empty', () => {
  const previousMembers = Environment.NODE_MEMBERS;
  try {
    // Compiled table-branch fixture only: actual F2P arena admission is refused by test_free_world.
    const free = startMaze();
    Environment.NODE_MEMBERS = false;
    draws({ '[proc,macro_maze_calculate_chest_loot]': [0] }, () => run(free, '[proc,macro_maze_calculate_chest_loot]'));
    assert.equal(count(free, 'airrune'), 15);
    settleMessage(free); leaveMaze(free);

    Environment.NODE_MEMBERS = true;
    const members = startMaze();
    draws({ '[proc,macro_maze_calculate_chest_loot]': [9] }, () => run(members, '[proc,macro_maze_calculate_chest_loot]'));
    assert.equal(count(members, '2dose1defense'), 1);
    settleMessage(members); leaveMaze(members);

    const empty = startMaze();
    World.currentTick += 400;
    const before = inventory(empty);
    run(empty, '[proc,macro_maze_calculate_chest_loot]');
    assert.equal(empty.getVar(v('macro_transmit')), 0);
    assert.deepEqual(inventory(empty), before, 'zero potential cannot roll or grant chest loot');
    settleMessage(empty); leaveMaze(empty);
  } finally {
    Environment.NODE_MEMBERS = previousMembers;
  }
});

check('Maze native low wall dispatches through its door handler and opens', () => {
  const p = startMaze();
  const { loc } = findMazeLoc(['macro_maze_walllow', 'macro_maze_walllow_safe1', 'macro_maze_walllow_safe2', 'macro_maze_walllow_safe3', 'macor_maze_walllow_safe4']);
  const inactive = id('LocType', 'macro_maze_wallinactive');
  const vector = run(p, '[proc,door_open]', [loc.angle, loc.shape]);
  const dx = vector.intStack[vector.isp - 2], dz = vector.intStack[vector.isp - 1];
  const x = loc.x + dx, z = loc.z + dz, level = loc.level;
  assert.equal(map.isMapBlocked(x, z, level), false, 'native door endpoint has clear terrain');
  position(p, level, x, z);
  const script = interact(p, loc);
  assert.equal(script.name, '[oploc1,_macro_maze_wall_door]');
  assert(World.getLoc(x, z, level, inactive), 'native door opening places the rotated inactive wall at its other endpoint');
  assert(World.getLoc(loc.x, loc.z, level, id('LocType', 'inviswall')), 'the original wall becomes the temporary open passage');
  leaveMaze(p);
});

check('Maze shrine caches potential before common return clears arena state', () => {
  const p = startMaze();
  const { loc } = findMazeLoc(['macro_maze_complete']);
  const inside = ([x, z]) => x >= loc.x && x < loc.x + loc.width && z >= loc.z && z < loc.z + loc.length;
  const walls = ['macro_maze_walllow', 'macro_maze_walllow_safe1', 'macro_maze_walllow_safe2', 'macro_maze_walllow_safe3', 'macor_maze_walllow_safe4'];
  let gate;
  search: for (let x = loc.x - 1; x <= loc.x + loc.width; x++) {
    for (let z = loc.z - 1; z <= loc.z + loc.length; z++) for (const name of walls) {
      const wall = World.getLoc(x, z, loc.level, id('LocType', name));
      if (!wall) continue;
      const vector = run(p, '[proc,door_open]', [wall.angle, wall.shape]);
      const a = [x, z], b = [x + vector.intStack[vector.isp - 2], z + vector.intStack[vector.isp - 1]];
      if (inside(a) === inside(b)) continue;
      const from = inside(a) ? b : a;
      if (map.isMapBlocked(from[0], from[1], loc.level)) continue;
      const policy = types.LocType.get(wall.type).params.get(id('ParamType', 'approach_direction'));
      const side = result(run(p, '[proc,check_axis]', [(loc.level << 28) | (from[0] << 14) | from[1], (loc.level << 28) | (x << 14) | z, wall.angle]));
      if (policy !== 0 && !(policy === 1 && side === 1) && !(policy === 2 && side === 0)) continue;
      gate = { wall, from };
      break search;
    }
  }
  assert(gate, 'a native central doorway connects clear terrain to the shrine footprint');
  position(p, loc.level, ...gate.from); // Labelled fixture travel to the real final doorway.
  interact(p, gate.wall);
  assert(p.inOperableDistance(loc), 'the original door crossing places the player in native shrine operate reach');
  draws({ '[proc,macro_maze_give_reward]': [99], '[proc,macro_maze_calc_reward]': [0, 0, 0] }, () => {
    const script = interact(p, loc);
    assert.equal(script.name, '[oploc1,macro_maze_complete]');
  });
  assert.deepEqual(tile(p), O);
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(p.getVar(v('macro_transmit')), 0);
  assert(count(p, 'coins') > 0, 'cached nonzero potential grants the three-roll portion');
});

check('Maze final reward uses the cited three-roll formula and unknown fourth-roll policy', () => {
  for (const [chance, rolls] of [[49, 4], [50, 3]]) {
    const p = player();
    const total = result(run(p, '[proc,macro_maze_total_level]'));
    const qty = Math.max(1, Math.floor(total * 100 * 10 / (3 * 100)));
    draws({ '[proc,macro_maze_give_reward]': [chance], '[proc,macro_maze_calc_reward]': Array(rolls).fill(0) }, () => {
      run(p, '[proc,macro_maze_give_reward]', [total, 100]);
    });
    assert.equal(count(p, 'coins'), qty * rolls);
  }
});

console.log('Maze compiled checks passed');
// Native World imports own workers; every assertion above is synchronous and complete.
process.exit(0);
