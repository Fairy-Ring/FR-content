import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  PlayerStat, ScriptProvider, ScriptState, ServerTriggerType, World, contentRoot, count,
  dialoguePage, engineModule, execute, held, id, inv, invCom, map, obj, player,
  resumeDialogue, seed, slotOf, tick as playerTick, tile, types, useLoc,
  interactionTick as playerInteractionTick, weakCount
} from '../swamp-caves/runtime.mjs';

// Match the ordinary world lifecycle phase after each player-only fixture tick.
function tick(p) {
  playerTick(p);
  World.processZones();
}
function interactionTick(p) {
  playerInteractionTick(p);
  World.processZones();
}

const ENGINE_INTERACTION = 1; // Interaction.ENGINE (SCRIPT=0, ENGINE=1).
const MAP = {
  camp: [[43, 57]],
  cave: [[43, 157]],
  relekka: [[40, 57], [41, 57], [42, 57], [43, 57]],
  whiteWolf: [[44, 54]]
};
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const MoveClickHandler = new (await engineModule('network/game/client/handler/MoveClickHandler.ts')).default();
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const { BlockWalk } = await engineModule('engine/entity/BlockWalk.ts');
const OpLocU = (await engineModule('network/game/client/model/OpLocU.ts')).default;
const locUseHandler = new (await engineModule('network/game/client/handler/OpLocUHandler.ts')).default();

function varId(name) {
  const varbit = types.VarBitType.getId(name);
  if (varbit >= 0) return { kind: 'bit', id: varbit };
  const varp = types.VarPlayerType.getId(name);
  assert(varp >= 0, `missing packed varbit/varp ${name}`);
  return { kind: 'player', id: varp };
}

function readVar(p, name) {
  const { kind, id: variable } = varId(name);
  return kind === 'bit' ? p.getVarBit(variable) : p.getVar(variable);
}

function writeVar(p, name, value) {
  const { kind, id: variable } = varId(name);
  if (kind === 'bit') p.setVarBit(variable, value);
  else p.setVar(variable, value);
}

function stage(p) {
  return readVar(p, 'mdaughter_quest_var');
}

function scanLoc(name, squares = MAP.camp) {
  const type = id('LocType', name);
  const found = [];
  for (const [mx, mz] of squares) {
    for (let x = mx * 64; x < (mx + 1) * 64; x++) {
      for (let z = mz * 64; z < (mz + 1) * 64; z++) {
        for (let level = 0; level < 4; level++) {
          const loc = World.getLoc(x, z, level, type);
          if (loc && !found.includes(loc)) found.push(loc);
        }
      }
    }
  }
  assert(found.length > 0, `no packed ${name} loc found in ${JSON.stringify(squares)}`);
  return found;
}

function scanObj(name, squares, receiver) {
  const type = obj(name);
  const found = [];
  for (const [mx, mz] of squares) {
    for (let x = mx * 64; x < (mx + 1) * 64; x++) {
      for (let z = mz * 64; z < (mz + 1) * 64; z++) {
        for (let level = 0; level < 4; level++) {
          const ground = World.getObj(x, z, level, type, receiver);
          if (ground && !found.includes(ground)) found.push(ground);
        }
      }
    }
  }
  return found;
}

function npc(name) {
  const type = id('NpcType', name);
  const found = World.npcs.filter(actor => actor?.baseType === type || actor?.type === type);
  assert(found.length > 0, `no packed ${name} NPC is active`);
  return found[0];
}

function blocked(level, x, z) {
  return map.isMapBlocked(x, z, level);
}

function moveAlongPath(p, path, bounds = null, label = 'native walk') {
  if (path.length === 0) return;
  const route = path.map(({ x, z }) => ({ x, z }));
  assert(MoveClickHandler.handle(new MoveClick(route, 0, true), p), `${label} accepted by the client movement handler`);
  const destination = path.at(-1);
  for (let step = 0; step < 256; step++) {
    interactionTick(p);
    if (bounds) {
      assert(p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ,
        `${label} stays within ${JSON.stringify(bounds)}; reached ${p.x},${p.z}`);
    }
    if (p.level === destination.level && p.x === destination.x && p.z === destination.z) return;
  }
  assert.fail(`${label} did not reach ${destination.level}_${destination.x}_${destination.z}; stopped at ${p.level}_${p.x}_${p.z}`);
}

function nativeRoute(p, destination, label) {
  assert.equal(p.level, destination.level, `${label} stays on the current level`);
  const route = [...map.findPath(p.level, p.x, p.z, destination.x, destination.z)].map(coord => {
    const { x, z } = CoordGrid.unpackCoord(coord);
    return { level: p.level, x, z };
  });
  assert(route.length > 0, `${label} has a packed collision route from ${p.level}_${p.x}_${p.z}`);
  assert.deepEqual(route.at(-1), { level: destination.level, x: destination.x, z: destination.z },
    `${label} reaches the requested tile rather than a nearest fallback`);
  return route;
}

function moveToTile(p, destination, label = 'native walk') {
  if (p.level === destination.level && p.x === destination.x && p.z === destination.z) return;
  moveAlongPath(p, nativeRoute(p, destination, label), null, label);
  assert.deepEqual(tile(p), [destination.level, destination.x, destination.z], `${label} reaches its destination`);
}

function placeAtStand(p, target, bounds = null) {
  const stand = findStand(p, target, bounds, 12, false);
  p.level = stand.level;
  p.x = stand.x;
  p.z = stand.z;
  assert(!blocked(p.level, p.x, p.z), `fixture stand ${p.level}_${p.x}_${p.z} is walkable`);
  assert(p.inOperableDistance(target), `fixture stand ${p.level}_${p.x}_${p.z} reaches target ${target.level}_${target.x}_${target.z}`);
  return stand;
}

function travelConstants() {
  const file = path.join(contentRoot, 'scripts/quests/quest_mdaughter/configs/mdaughter_travel.constant');
  const text = fs.readFileSync(file, 'utf8');
  const result = new Map();
  for (const match of text.matchAll(/^\^(mdaughter_[a-z0-9_]+) = (\d+)_(\d+)_(\d+)_(\d+)_(\d+)$/gm)) {
    const [, name, level, mx, mz, lx, lz] = match;
    result.set(name, { level: Number(level), x: Number(mx) * 64 + Number(lx), z: Number(mz) * 64 + Number(lz) });
  }
  return result;
}

function assertTravelEndpoints() {
  const endpoints = travelConstants();
  for (const name of [
    'mdaughter_tree_shore', 'mdaughter_tree_island',
    'mdaughter_pole_first_island', 'mdaughter_pole_second_island',
    'mdaughter_stone_west_island', 'mdaughter_stone_center_island',
    'mdaughter_cave_surface', 'mdaughter_cave_inside'
  ]) {
    const point = endpoints.get(name);
    assert(point, `travel endpoint ${name} is declared`);
    assert(!blocked(point.level, point.x, point.z), `travel endpoint ${name} ${point.level}_${point.x}_${point.z} is walkable in packed collision`);
  }
  return endpoints;
}
function findBoundedApproach(p, target, start, maxRange) {
  const origin = tile(p);
  const candidates = [];
  const width = target.width ?? 1;
  const length = target.length ?? 1;
  for (let x = target.x - 10; x <= target.x + width + 10; x++) {
    for (let z = target.z - 10; z <= target.z + length + 10; z++) {
      if (x === start.x && z === start.z || blocked(target.level, x, z)) continue;
      p.level = target.level;
      p.x = x;
      p.z = z;
      if (!p.inApproachDistance(10, target) || p.inApproachDistance(maxRange, target) || p.inOperableDistance(target)) continue;
      const route = map.findPath(target.level, x, z, start.x, start.z);
      if (route.length === 0) continue;
      const last = CoordGrid.unpackCoord(route.at(-1));
      if (last.x !== start.x || last.z !== start.z) continue;
      candidates.push({ level: target.level, x, z, distance: Math.abs(x - start.x) + Math.abs(z - start.z) });
    }
  }
  p.level = origin[0];
  p.x = origin[1];
  p.z = origin[2];
  candidates.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
  assert(candidates.length > 0, `no packed dry AP approach to ${target.level}_${target.x}_${target.z} outside range ${maxRange} but inside range 10, with a route to ${start.x}_${start.z}`);
  return candidates[0];
}

function crossBoundedTravel(p, target, op, startName, landingName, maxRange, label) {
  const endpoints = travelConstants();
  const start = endpoints.get(startName);
  const landing = endpoints.get(landingName);
  assert(start && landing, `${label} endpoints are declared`);
  assert(!blocked(start.level, start.x, start.z), `${label} start ${start.level}_${start.x}_${start.z} is walkable`);
  assert(!blocked(landing.level, landing.x, landing.z), `${label} landing ${landing.level}_${landing.x}_${landing.z} is walkable`);

  const approach = findBoundedApproach(p, target, start, maxRange);
  moveToTile(p, approach, `${label} native walk to bounded AP approach`);
  const approachTile = tile(p);
  assert.notDeepEqual(approachTile, [start.level, start.x, start.z], `${label} starts away from the scripted crossing tile`);
  p.clearInteraction();
  assert(MoveClickHandler.handle(new MoveClick(nativeRoute(p, start, label), 0, true), p), `${label} MOVE_OPCLICK accepted`);
  assert(p.setInteraction(ENGINE_INTERACTION, target, ServerTriggerType.APLOC1 + op - 1), `${label} client operation accepted`);
  assert(p.inApproachDistance(10, target), `${label} starts inside the normal interaction admission range`);
  const trigger = p.getOpTrigger();
  assert(trigger, `${label} resolves through compiled AP/OP dispatch`);
  p.processInteraction();
  assert.notDeepEqual(tile(p), [landing.level, landing.x, landing.z], `${label} does not teleport before its native walk`);
  let sawWeakQueue = weakCount(p) > 0;
  let sawWalk = false;
  p.resetEntity(false);
  for (let step = 0; step < 256; step++) {
    tick(p);
    sawWeakQueue ||= weakCount(p) > 0;
    p.processInteraction();
    sawWeakQueue ||= weakCount(p) > 0;
    p.resetEntity(false);
    sawWalk ||= p.x !== approachTile[1] || p.z !== approachTile[2];
    if (p.level === landing.level && p.x === landing.x && p.z === landing.z && weakCount(p) === 0) break;
  }
  assert(sawWalk, `${label} uses native walking from ${approachTile}; final=${tile(p)}, weak=${weakCount(p)}, messages=${JSON.stringify(p.messages.slice(-3))}`);
  assert(sawWeakQueue, `${label} defers its crossing through the player weakqueue`);
  assert.deepEqual(tile(p), [landing.level, landing.x, landing.z], `${label} lands at the selected endpoint after the approach queue`);
  return trigger;
}

function crossTravel(p, target, op, startName, landingName, maxRange, label) {
  const endpoints = travelConstants(), start = endpoints.get(startName), landing = endpoints.get(landingName);
  moveToTile(p, start, `${label} native walk to the crossing`);
  assert(Math.max(Math.abs(p.x - target.x), Math.abs(p.z - target.z)) <= maxRange,
    `${label} starts inside the script's native admission radius`);
  const result = operate(p, target, 'loc', op, [], label, true);
  for (let step = 0; step < 256 && weakCount(p) > 0; step++) interactionTick(p);
  assert.deepEqual(tile(p), [landing.level, landing.x, landing.z], `${label} crosses from its actual packed-map stand`);
  assert(!blocked(p.level, p.x, p.z), `${label} lands on a walkable tile`);
  return result;
}

function findStand(p, target, bounds = null, radius = 12, requireRoute = true) {
  const origin = { level: p.level, x: p.x, z: p.z };
  const targetWidth = target.width ?? 1;
  const targetLength = target.length ?? 1;
  const cx = target.x + Math.floor(targetWidth / 2);
  const cz = target.z + Math.floor(targetLength / 2);
  const candidates = [];
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let z = cz - radius; z <= cz + radius; z++) {
      if (bounds && (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ)) continue;
      if (!blocked(target.level, x, z)) candidates.push({ level: target.level, x, z, distance: (x - cx) ** 2 + (z - cz) ** 2 });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
  for (const candidate of candidates) {
    p.level = candidate.level;
    p.x = candidate.x;
    p.z = candidate.z;
    if (p.inOperableDistance(target)) {
      if (requireRoute && (origin.x !== candidate.x || origin.z !== candidate.z)) {
        const route = map.findPath(origin.level, origin.x, origin.z, candidate.x, candidate.z);
        if (route.length === 0) continue;
        const last = CoordGrid.unpackCoord(route.at(-1));
        if (last.x !== candidate.x || last.z !== candidate.z) continue;
      }
      p.level = origin.level;
      p.x = origin.x;
      p.z = origin.z;
      return candidate;
    }
  }
  p.level = origin.level;
  p.x = origin.x;
  p.z = origin.z;
  assert.fail(`no walkable ordinary-operation stand near ${target.type} at ${target.level}_${target.x}_${target.z}${bounds ? ` inside ${JSON.stringify(bounds)}` : ''}`);
}

function goToStand(p, target, bounds = null) {
  const stand = findStand(p, target, bounds);
  moveToTile(p, stand, `walk to ordinary stand for ${target.type}`);
  assert(p.inOperableDistance(target), `actual stand ${p.level}_${p.x}_${p.z} reaches target ${target.level}_${target.x}_${target.z}`);
  return stand;
}
function readerDistance(from, loc, width, length) {
  const dx = Math.max(loc.x - from.x, 0, from.x - (loc.x + width - 1));
  const dz = Math.max(loc.z - from.z, 0, from.z - (loc.z + length - 1));
  return Math.max(dx, dz);
}

function findCenterApproach(p, start, target, bounds) {
  const key = (x, z) => `${x},${z}`;
  const nodes = [{ level: start.level, x: start.x, z: start.z }];
  const previous = new Map([[key(start.x, start.z), null]]);
  const origin = tile(p);
  for (let index = 0; index < nodes.length; index++) {
    const current = nodes[index];
    p.level = current.level;
    p.x = current.x;
    p.z = current.z;
    if (p.inOperableDistance(target)) {
      const path = [];
      let cursor = key(current.x, current.z);
      while (cursor !== null) {
        const node = nodes.find(value => key(value.x, value.z) === cursor);
        path.unshift(node);
        cursor = previous.get(cursor);
      }
      p.level = origin[0];
      p.x = origin[1];
      p.z = origin[2];
      return path;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx;
      const z = current.z + dz;
      const nextKey = key(x, z);
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ
        || previous.has(nextKey) || blocked(start.level, x, z)
        || !map.isLineOfWalk(start.level, current.x, current.z, x, z)) continue;
      previous.set(nextKey, key(current.x, current.z));
      nodes.push({ level: start.level, x, z });
    }
  }
  p.level = origin[0];
  p.x = origin[1];
  p.z = origin[2];
  return null;
}

function finishInteraction(p, choices, label) {
  const options = [...choices];
  const pages = [];
  for (let step = 0; step < 200; step++) {
    const state = p.activeScript;
    if (!state || state.execution === ScriptState.FINISHED) break;
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} script aborted`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      pages.push(...dialoguePage(p));
      const root = types.Component.get(p.modalChat).comName;
      const isChoice = /^multi[2-5]$/.test(root);
      if (isChoice) {
        assert(options.length > 0, `${label} reached an unselected choice ${root}`);
        resumeDialogue(p, options.shift());
      } else {
        resumeDialogue(p);
      }
      continue;
    }
    if (state.execution === ScriptState.SUSPENDED) {
      tick(p);
      continue;
    }
    break;
  }
  assert.equal(options.length, 0, `${label} had unused dialogue choices ${options}`);
  assert(!p.activeScript || [ScriptState.FINISHED, ScriptState.PAUSEBUTTON].includes(p.activeScript.execution), `${label} did not settle`);
  return pages.join(' ');
}

function operate(p, target, kind, op, choices = [], label = `${kind} operation ${op}`, allowApproach = false) {
  const base = kind === 'npc' ? ServerTriggerType.APNPC1 : kind === 'loc' ? ServerTriggerType.APLOC1 : ServerTriggerType.APOBJ1;
  p.clearInteraction();
  p.originX = p.x;
  p.originZ = p.z;
  assert(p.setInteraction(ENGINE_INTERACTION, target, base + op - 1), `${label} interaction accepted`);
  assert(p.inOperableDistance(target) || (allowApproach && p.inApproachDistance(p.apRange, target)),
    `${label} from ${p.level}_${p.x}_${p.z} is ordinarily reachable${allowApproach ? ' or inside its bounded approach range' : ''}`);
  const trigger = p.getOpTrigger();
  assert(trigger, `${label} resolves through production trigger dispatch`);
  p.dialogueMark = p.packets.length;
  p.processInteraction();
  const text = finishInteraction(p, choices, label);
  return { trigger, text, tile: tile(p) };
}

function dispatchPoolListenFromArrival(p) {
  const arrival = { level: 0, x: 2779, z: 3691 };
  const bounds = { minX: 2779, maxX: 2786, minZ: 3690, maxZ: 3696 };
  assert.deepEqual(tile(p), [arrival.level, arrival.x, arrival.z], 'plank travel ends at the actual center-island arrival tile');
  assert(!blocked(arrival.level, arrival.x, arrival.z), `plank arrival ${arrival.x},${arrival.z} is walkable in packed collision`);

  const poolType = types.LocType.get(id('LocType', 'mdaughter_sulphar_gas'));
  assert.equal(poolType.width, 2, 'nearest gas has its packed 2x2 width');
  assert.equal(poolType.length, 2, 'nearest gas has its packed 2x2 length');
  const gas = scanLoc('mdaughter_sulphar_gas', MAP.camp)
    .sort((a, b) => readerDistance(arrival, a, poolType.width, poolType.length) - readerDistance(arrival, b, poolType.width, poolType.length)
      || a.x - b.x || a.z - b.z)[0];
  assert(gas, 'nearest packed sulphur gas exists');
  const approachPath = findCenterApproach(p, arrival, gas, bounds);
  assert(approachPath, `no ordinary adjacency to nearest 2x2 gas ${gas.level}_${gas.x}_${gas.z} from plank arrival ${arrival.x}_${arrival.z} while staying inside center bounds ${JSON.stringify(bounds)}`);
  moveAlongPath(p, approachPath, bounds, `ordinary walk from plank arrival to nearest gas ${gas.level}_${gas.x}_${gas.z}`);
  assert(p.inOperableDistance(gas), `ordinary OP_LOC1 reach to nearest gas from ${p.x},${p.z}`);
  const result = operate(p, gas, 'loc', 1, [2, 2, 1, 1], 'center-pool Listen-to');
  assert.equal(readVar(p, 'mdaughter_quest_var'), 10, 'pool conversation advances the search stage to tasks');
  return result;
}

function assertQuestProgressPacket(p) {
  const component = id('Component', 'questlist:mdaughter');
  const packet = p.packets.filter(value => value.constructor.name === 'IfSetColour' && value.component === component).at(-1);
  assert.equal(packet?.colour, 0x7fe0, 'accepted search paints the quest-list row yellow');
}

function assertLoginColour(p, expected) {
  execute('[proc,update_questlist]', p);
  const row = p.packets.filter(packet => packet.constructor.name === 'IfSetColour' && packet.component === id('Component', 'questlist:mdaughter')).at(-1);
  assert.equal(row?.colour, expected, 'login reconstruction preserves the actual Mountain Daughter progress colour');
}
function collectMudAtCellStand(p) {
  const stand = { level: 0, x: 2804, z: 3661 };
  const root = scanLoc('mdaughter_roots_1').find(loc => loc.x === 2805 && loc.z === 3661);
  assert(root, 'the packed root next to the mud fixture stand exists');
  assert(!blocked(stand.level, stand.x, stand.z), 'the mud fixture stands on packed dry ground');
  p.level = stand.level;
  p.x = stand.x;
  p.z = stand.z;
  operate(p, root, 'loc', 1, [], 'Dig-below the muddy root');
  assert.equal(count(p, 'mdaughter_mud'), 1, 'the compiled supply operation produces mud');
}

function crossWithItem(p, item, target, start, landing, label) {
  moveToTile(p, start, `${label} native walk to the island edge`);
  const before = count(p, item), moves = [], exactMoves = [];
  const bridge = travelConstants().get('mdaughter_plank_bridge');
  const teleport = p.teleport, exactMove = p.exactMove;
  p.teleport = function(...args) {
    const from = tile(this);
    const result = teleport.apply(this, args);
    moves.push({ from, to: tile(this), bridge: !!World.getLoc(bridge.x, bridge.z, bridge.level, id('LocType', 'mdaughter_short_plank')) });
    return result;
  };
  p.exactMove = function(...args) {
    exactMoves.push({ args, animation: this.animId });
    return exactMove.apply(this, args);
  };
  try {
    assert(useLoc(p, item, target), `${label} item-on-location client action accepted`);
    for (let step = 0; step < 256; step++) {
      if (p.level === landing.level && p.x === landing.x && p.z === landing.z && weakCount(p) === 0
        && (!p.activeScript || p.activeScript.execution === ScriptState.FINISHED)) break;
      interactionTick(p);
    }
  } finally {
    p.teleport = teleport;
    p.exactMove = exactMove;
  }
  assert.deepEqual(tile(p), [landing.level, landing.x, landing.z], `${label} reaches its actual packed-map landing`);
  assert.equal(count(p, item), before, `${label} retains its crossing item`);
  if (item === 'mdaughter_stick') {
    const sequence = id('SeqType', 'mdaughter_pole_vault');
    assert.deepEqual(exactMoves, [{ args: [start.x, start.z, landing.x, landing.z, 0,
      types.SeqType.get(sequence).duration, landing.z > start.z ? 0 : 2], animation: sequence }],
    `${label} sends the named pole-vault animation and a full-sequence exact movement`);
  } else {
    assert.equal(exactMoves.length, 0, `${label} uses ordinary walking, not a borrowed obstacle animation`);
    assert.deepEqual(moves.map(move => move.to), Array.from({ length: Math.abs(landing.x - start.x) }, (_, i) =>
      [start.level, start.x + Math.sign(landing.x - start.x) * (i + 1), start.z]),
    `${label} walks every tile across the gap instead of teleporting to its endpoint`);
    assert(moves.every(move => move.bridge), `${label} displays the laid plank throughout the walk`);
    assert(!World.getLoc(bridge.x, bridge.z, bridge.level, id('LocType', 'mdaughter_short_plank')),
      `${label} removes the temporary bridge after crossing`);
  }
}

function travelToCenter(p) {
  const endpoints = assertTravelEndpoints();
  const tree = scanLoc('mdaughter_lake_tree', MAP.camp)[0];
  const pole = scanLoc('mdaughter_polerocks', MAP.camp)[0];
  const flatstone = scanLoc('mdaughter_flatstone1', MAP.camp)[0];
  const flatstoneReturn = scanLoc('mdaughter_flatstone2', MAP.camp)[0];
  assert(tree && pole && flatstone && flatstoneReturn, 'both visible flatstone forms and the tree/pole rocks exist');

  collectMudAtCellStand(p);
  goToStand(p, tree);
  const beforeMudGate = tile(p);
  assert.equal(readVar(p, 'mdaughter_mud_var'), 0, 'mud is not applied merely by collecting it');
  operate(p, tree, 'loc', 3, [], 'Lake-tree crossing without applied mud', true);
  assert.notDeepEqual(tile(p), [endpoints.get('mdaughter_tree_island').level, endpoints.get('mdaughter_tree_island').x, endpoints.get('mdaughter_tree_island').z],
    'lake-tree crossing refuses before mud is applied');
  assert.equal(readVar(p, 'mdaughter_quest_var'), 1, 'a failed crossing does not change the main quest stage');
  assert(beforeMudGate.length === 3);

  assert(useLoc(p, 'mdaughter_mud', tree), 'apply-mud item-on-location dispatch accepted');
  finishInteraction(p, [], 'apply mud to lake tree');
  assert.equal(count(p, 'mdaughter_mud'), 0);
  assert.equal(readVar(p, 'mdaughter_mud_var'), 1, 'mud application writes its subprogress');
  p.baseLevels[PlayerStat.AGILITY] = 19;
  p.levels[PlayerStat.AGILITY] = 19;
  const beforeAgilityGate = tile(p);
  operate(p, tree, 'loc', 3, [], 'Lake-tree crossing below 20 Agility', true);
  assert.deepEqual(tile(p), beforeAgilityGate, 'the tree gate refuses level 19 Agility');
  p.baseLevels[PlayerStat.AGILITY] = 20;
  p.levels[PlayerStat.AGILITY] = 20;

  crossBoundedTravel(p, tree, 3, 'mdaughter_tree_shore', 'mdaughter_tree_island', 5, 'Lake-tree bounded native approach');
  moveToTile(p, endpoints.get('mdaughter_pole_first_island'), 'walk to goat-pen pole start');
  operate(p, pole, 'loc', 1, [], 'Jump-across pole rocks without using the stick', true);
  const shore = endpoints.get('mdaughter_tree_shore');
  assert.deepEqual(tile(p), [shore.level, shore.x, shore.z], 'unaided pole-rock Jump-across returns to shore');
  assert(p.messages.includes('You slip and fall into the water!'));
  assert(p.messages.includes('You only just manage to get to shore!'));
  assert.equal(count(p, 'mdaughter_stick'), 0);
  const sticks = scanObj('mdaughter_stick', MAP.camp, p.hash64);
  assert(sticks.length > 0, 'the static mdaughter_stick ground object exists');
  goToStand(p, sticks[0]);
  operate(p, sticks[0], 'obj', 3, [], 'Take the static stick');
  assert.equal(count(p, 'mdaughter_stick'), 1, 'the real static stick is picked up');
  seed(p, ['woodplank']);

  crossTravel(p, tree, 3, 'mdaughter_tree_shore', 'mdaughter_tree_island', 5, 'Lake-tree crossing with mud and Agility');
  moveToTile(p, endpoints.get('mdaughter_pole_first_island'), 'walk to pole start with stick');
  crossWithItem(p, 'mdaughter_stick', pole, endpoints.get('mdaughter_pole_first_island'), endpoints.get('mdaughter_pole_second_island'), 'Pole crossing with stick');
  moveToTile(p, endpoints.get('mdaughter_stone_west_island'), 'walk to west flatstone');
  operate(p, flatstone, 'loc', 1, [], 'Jump-across flatstone without using a plank', true);
  assert.deepEqual(tile(p), [shore.level, shore.x, shore.z], 'unaided flatstone Jump-across returns to shore');
  assert.equal(count(p, 'woodplank'), 1, 'a failed unaided jump does not consume a carried plank');
  crossTravel(p, tree, 3, 'mdaughter_tree_shore', 'mdaughter_tree_island', 5, 'Tree crossing after the unaided jump');
  crossWithItem(p, 'mdaughter_stick', pole, endpoints.get('mdaughter_pole_first_island'), endpoints.get('mdaughter_pole_second_island'), 'Pole crossing after the unaided jump');
  crossWithItem(p, 'woodplank', flatstone, endpoints.get('mdaughter_stone_west_island'), endpoints.get('mdaughter_stone_center_island'), 'Place and cross the temporary plank');
  crossWithItem(p, 'woodplank', flatstoneReturn, endpoints.get('mdaughter_stone_center_island'), endpoints.get('mdaughter_stone_west_island'), 'Return with the same plank');
  crossWithItem(p, 'woodplank', flatstone, endpoints.get('mdaughter_stone_west_island'), endpoints.get('mdaughter_stone_center_island'), 'Cross again with the same plank');
  return { endpoints, tree, pole, flatstone, flatstoneReturn };
}

function returnToCamp(p, { endpoints, tree, pole, flatstoneReturn }) {
  crossWithItem(p, 'woodplank', flatstoneReturn, endpoints.get('mdaughter_stone_center_island'), endpoints.get('mdaughter_stone_west_island'), 'Return across flatstones');
  moveToTile(p, endpoints.get('mdaughter_pole_second_island'), 'walk to pole return start');
  crossWithItem(p, 'mdaughter_stick', pole, endpoints.get('mdaughter_pole_second_island'), endpoints.get('mdaughter_pole_first_island'), 'Return across pole');
  moveToTile(p, endpoints.get('mdaughter_tree_island'), 'walk to lake-tree return start');
  crossTravel(p, tree, 3, 'mdaughter_tree_island', 'mdaughter_tree_shore', 5, 'Return across lake tree to camp');
}


function questConstant(name) {
  const files = [
    path.join(contentRoot, 'scripts/quests/quest_mdaughter/configs/mdaughter.constant'),
    path.join(contentRoot, 'scripts/quests/quest_viking/configs/quest_viking.constant'),
    path.join(contentRoot, 'scripts/general/configs/quest.constant')
  ];
  for (const file of files) {
    const declaration = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(line => line.startsWith(`^${name} = `));
    if (declaration) return Number(declaration.slice(declaration.indexOf('=') + 1).trim());
  }
  assert.fail(`missing quest constant ${name}`);
}

function testBrundtHook(vikingValue, originalChoices, originalText) {
  const p = player();
  writeVar(p, 'mdaughter_quest_var', questConstant('mdaughter_tasks'));
  writeVar(p, 'mdaughter_relations_var', 2);
  writeVar(p, 'viking', vikingValue);
  const chieftain = npc('viking_brundt');
  placeAtStand(p, chieftain);
  const original = operate(p, chieftain, 'npc', 1, originalChoices, 'Brundt original route');
  assert.equal(readVar(p, 'mdaughter_relations_var'), 2, 'choosing “Ask about anything else” does not call the quest proc');
  assert(original.text.includes(originalText), `original Brundt route remains: ${originalText}`);
  placeAtStand(p, chieftain);
  const quest = operate(p, chieftain, 'npc', 1, [1], 'Brundt Mountain Daughter topic');
  assert.equal(readVar(p, 'mdaughter_relations_var'), 3, 'only selecting the Mountain Daughter topic dispatches mdaughter_brundt');
  assert(quest.text.includes('representative'), 'the selected quest topic reaches the existing Mountain Daughter conversation');
}

function testBrundtRoutes() {
  testBrundtHook(questConstant('viking_started'), [2], 'Greetings again outerlander');
  testBrundtHook(questConstant('viking_complete'), [2, 1], 'Hello again');
}

function startQuest(p) {
  const hamal = npc('mdaughter_hamal');
  const door = scanLoc('mdaughter_tent_door').sort((a, b) =>
    Math.abs(a.x - hamal.x) + Math.abs(a.z - hamal.z) - Math.abs(b.x - hamal.x) - Math.abs(b.z - hamal.z))[0];
  goToStand(p, door);
  operate(p, door, 'loc', 1, [], 'Open Hamal tent door');
  goToStand(p, hamal);
  const result = operate(p, hamal, 'npc', 1, [1, 1, 1], 'Hamal quest offer');
  assert.equal(stage(p), 1, 'Hamal acceptance writes mdaughter_search through compiled dispatch');
  assertQuestProgressPacket(p);
  return result;
}

function talkTo(p, name, choices = []) {
  const target = npc(name);
  placeAtStand(p, target);
  return operate(p, target, 'npc', 1, choices, `Talk to ${name}`);
}

function visitPool(p, travel, expected) {
  const { tree, pole, flatstone } = travel;
  moveToTile(p, travel.endpoints.get('mdaughter_tree_shore'), 'walk back to the pool route');
  crossTravel(p, tree, 3, 'mdaughter_tree_shore', 'mdaughter_tree_island', 5, 'Revisit tree crossing');
  crossWithItem(p, 'mdaughter_stick', pole, travel.endpoints.get('mdaughter_pole_first_island'), travel.endpoints.get('mdaughter_pole_second_island'), 'Revisit pole crossing');
  crossWithItem(p, 'woodplank', flatstone, travel.endpoints.get('mdaughter_stone_west_island'), travel.endpoints.get('mdaughter_stone_center_island'), 'Revisit plank crossing');
  const gas = scanLoc('mdaughter_sulphar_gas').sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.z - p.z) - Math.abs(b.x - p.x) - Math.abs(b.z - p.z))[0];
  goToStand(p, gas, { minX: 2779, maxX: 2786, minZ: 3690, maxZ: 3696 });
  operate(p, gas, 'loc', 1, [], 'Return to Asleif');
  assert.equal(stage(p), expected, 'Asleif advances only after both requested tasks are completed');
}

function completeTasks(p, travel) {
  talkTo(p, 'mdaughter_hamal', [2]);
  assert.equal(readVar(p, 'mdaughter_relations_var'), 1);
  talkTo(p, 'mdaughter_svidi', [2]);
  assert.equal(readVar(p, 'mdaughter_relations_var'), 2);
  talkTo(p, 'viking_brundt', [1]);
  assert.equal(readVar(p, 'mdaughter_relations_var'), 3);

  [p.level, p.x, p.z] = [0, 2799, 3666]; // Disclosed local travel fixture, outside the rock tent.
  assert(!blocked(p.level, p.x, p.z));
  const door = scanLoc('mdaughter_rocktent_door')[0];
  operate(p, door, 'loc', 1, [], 'Go through the ancient-rock tent door');
  assert.deepEqual(tile(p), [0, 2799, 3665], 'the door actually crosses into the tent rather than returning outside');
  const rock = scanLoc('mdaughter_ancient_rock')[0];
  const early = seed(player(), ['bronze_pickaxe']);
  placeAtStand(early, rock);
  assert(useLoc(early, 'bronze_pickaxe', rock));
  finishInteraction(early, [], 'Mine before Brundt requests the rock');
  assert.equal(count(early, 'mdaughter_half_rock'), 0, 'a pickaxe alone does not bypass the task prerequisite');
  goToStand(p, rock);
  seed(p, ['bronze_axe']);
  assert(useLoc(p, 'bronze_axe', rock));
  finishInteraction(p, [], 'wrong tool on the ancient rock');
  assert.equal(count(p, 'mdaughter_half_rock'), 0, 'an axe is not a pickaxe');
  seed(p, ['bronze_pickaxe']);
  assert(useLoc(p, 'bronze_pickaxe', rock));
  finishInteraction(p, [], 'split the ancient rock');
  assert.equal(count(p, 'mdaughter_half_rock'), 1);
  const split = World.getLoc(rock.x, rock.z, rock.level, id('LocType', 'mdaughter_ancient_rock_splitting'));
  assert(split, 'mining changes the actual packed loc to the visible split form');
  p.invDel(inv, obj('mdaughter_half_rock'), 1); // Lost-item fixture exercises the visible form.
  assert(useLoc(p, 'bronze_pickaxe', split));
  finishInteraction(p, [], 'mine the visible split rock after losing the first piece');
  assert.equal(count(p, 'mdaughter_half_rock'), 1);
  moveToTile(p, { level: 0, x: 2799, z: 3665 }, 'walk back to the rock-tent door');
  operate(p, door, 'loc', 1, [], 'Leave the ancient-rock tent');
  assert.deepEqual(tile(p), [0, 2799, 3666], 'the same door also exits to its actual other side');

  talkTo(p, 'viking_brundt', [1]);
  assert.equal(readVar(p, 'mdaughter_relations_var'), 4);
  assert.equal(count(p, 'mdaughter_half_rock'), 0);
  assert.equal(count(p, 'mdaughter_safety_guarantee'), 1);
  talkTo(p, 'mdaughter_svidi');
  assert.equal(readVar(p, 'mdaughter_relations_var'), 5);
  assert.equal(count(p, 'mdaughter_safety_guarantee'), 0);
  placeAtStand(p, npc('mdaughter_hamal')); // Regional travel back from Rellekka.
  visitPool(p, travel, 10);
  returnToCamp(p, travel);
  talkTo(p, 'mdaughter_hamal', [2]);
  assert.equal(readVar(p, 'mdaughter_hamal_relations_done'), 1, 'delivery is not the report to Hamal');
  visitPool(p, travel, 10);
  returnToCamp(p, travel);

  talkTo(p, 'mdaughter_hamal', [3]);
  assert.equal(readVar(p, 'mdaughter_food_var'), 1);
  talkTo(p, 'mdaughter_jokul');
  assert.equal(readVar(p, 'mdaughter_food_var'), 2);
  const bush = scanLoc('mdaughter_white_pearl_bush', MAP.whiteWolf)[0];
  placeAtStand(p, bush);
  operate(p, bush, 'loc', 3, [], 'Pick thorny fruit without gloves');
  assert.equal(count(p, 'mdaughter_white_pearl_fruit'), 0);
  seed(p, ['leather_gloves']);
  assert(held(p, 'leather_gloves', 2));
  finishInteraction(p, [], 'wear ordinary gloves');
  operate(p, bush, 'loc', 3, [], 'Pick White Pearl fruit with gloves');
  assert.equal(count(p, 'mdaughter_white_pearl_fruit'), 1);
  talkTo(p, 'mdaughter_hamal', [3]);
  assert.equal(readVar(p, 'mdaughter_food_var'), 2, 'a piece of fruit does not feed the tribe');
  assert(held(p, 'mdaughter_white_pearl_fruit', 3));
  finishInteraction(p, [], 'eat the fruit and keep its seed');
  assert.equal(count(p, 'mdaughter_white_pearl_fruit'), 0);
  assert.equal(count(p, 'mdaughter_white_pearl_seed'), 1);
  talkTo(p, 'mdaughter_hamal', [3]);
  assert.equal(count(p, 'mdaughter_white_pearl_seed'), 0);
  assert.equal(readVar(p, 'mdaughter_food_var'), 3);
  visitPool(p, travel, 20);
  returnToCamp(p, travel);
}

function spawnScript(n) {
  const config = types.NpcType.get(n.type);
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, n.type, config.category);
  assert.match(trigger?.name ?? '', /mdaughter_/, 'the actual NPC spawn dispatch initializes its typed owner');
  n.executeScript(ScriptRunner.init(trigger, n));
}

function damageNpc(n, amount) {
  n.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, amount);
  for (let step = 0; step < 80; step++) {
    n.processQueue();
    if (!n.activeScript && n.queue.head() === null) return;
    World.currentTick = Math.max(World.currentTick + 1, n.delayedUntil);
    n.delayed = false;
    if (n.activeScript) n.executeScript(n.activeScript);
  }
  assert.fail('the real NPC damage/death queues did not finish');
}

function proveForeignHeroDoesNotCredit(owner, other, root) {
  for (const name of ['mdaughter_multi_bear', 'mdaughter_bearman', 'mdaughter_bearman_fighter']) {
    const n = new Npc(root.level, root.x, root.z, root.width, root.length,
      EntityLifeCycle.RESPAWN, World.getNextNid(), id('NpcType', name), BlockWalk.NONE);
    World.addNpc(n, -1);
    spawnScript(n);
    n.vars[id('VarNpcType', 'npc_attacking_uid')] = owner.uid;
    n.vars[id('VarNpcType', 'npc_aggressive_player')] = other.uid;
    const hp = n.levels[NpcStat.HITPOINTS];
    damageNpc(n, 7);
    assert.equal(n.levels[NpcStat.HITPOINTS], hp, `${name} rejects a damage queue without its owner as aggressor`);
    n.vars[id('VarNpcType', 'npc_aggressive_player')] = owner.uid;
    n.heroPoints.addHero(other.hash64, hp);
    damageNpc(n, hp);
    for (let turn = 0; turn < 4; turn++) { tick(owner); tick(other); }
    assert.equal(stage(owner), 20, `${name} does not credit the owner when another player is the hero`);
    assert.equal(stage(other), 20, `${name} does not credit the non-owner hero`);
    assert.equal(count(other, 'mdaughter_bear_helmet'), 0);
  }
}

function defeatKendal(p) {
  [p.level, p.x, p.z] = [0, 2808, 3702]; // Disclosed travel to the real cave approach.
  assert(!blocked(p.level, p.x, p.z));
  const entrance = scanLoc('mdaughter_caveentrance')[0];
  const treeAt = travelConstants().get('mdaughter_cave_tree');
  const tree = World.getLoc(treeAt.x, treeAt.z, treeAt.level, id('LocType', 'mdaughter_impassable_tree2'));
  assert(tree, 'the actual cave-mouth blocker exists on the packed map');
  operate(p, entrance, 'loc', 1, [], 'Blocked cave entrance', true);
  assert.deepEqual(tile(p), [0, 2808, 3702], 'the blocking tree must first be chopped');
  p.invDel(inv, obj('bronze_axe'), 1);
  operate(p, tree, 'loc', 1, [], 'Chop without an axe', true);
  assert(World.getLoc(tree.x, tree.z, tree.level, tree.type));
  seed(p, ['bronze_axe']);
  operate(p, tree, 'loc', 1, [], 'Chop the actual cave-path tree', true);
  assert(World.getLoc(tree.x, tree.z, tree.level, id('LocType', 'mdaughter_passable_tree')));
  operate(p, entrance, 'loc', 1, [], 'Enter the opened cave', true);
  assert.deepEqual(tile(p), [0, 2808, 10104]);
  const kendal = npc('mdaughter_multi_bear');
  spawnScript(kendal);
  goToStand(p, kendal);
  const before = kendal.levels[NpcStat.HITPOINTS];
  const unstarted = player();
  placeAtStand(unstarted, kendal);
  operate(unstarted, kendal, 'npc', 1, [], 'Speak to the Kendal before starting the quest');
  operate(unstarted, kendal, 'npc', 2, [], 'Attack the Kendal before starting the quest');
  assert.equal(stage(unstarted), 0);
  damageNpc(kendal, 7);
  assert.equal(kendal.levels[NpcStat.HITPOINTS], before, 'unowned damage cannot bypass the unmasking gate');
  const refused = operate(p, kendal, 'npc', 2, [], 'Attack before unmasking');
  assert.match(refused.trigger.name, /\[opnpc2,mdaughter_bearman\]/, 'Attack dispatch uses the form the player sees');
  assert.equal(kendal.levels[NpcStat.HITPOINTS], before);
  const remains = scanObj('mdaughter_daughter_corpse', MAP.cave, p.hash64)[0];
  assert(remains, 'the real corpse is present in the packed cave');
  goToStand(p, remains);
  operate(p, remains, 'obj', 3, [], 'Take the corpse before defeating the Kendal');
  assert.equal(count(p, 'mdaughter_daughter_corpse'), 0);
  goToStand(p, kendal);
  const reveal = operate(p, kendal, 'npc', 1, [1, 2, 3, 2, 1], 'Unmask the visible Kendal');
  assert.match(reveal.trigger.name, /\[opnpc1,mdaughter_bearman\]/, 'Talk-to dispatch uses the visible form, not a directly named handler');
  assert.equal(readVar(p, 'mdaughter_bear_discovery'), 1);
  assert.equal(readVar(p, 'mdaughter_bear_mayattack'), 1);
  const other = player();
  writeVar(other, 'mdaughter_quest_var', 20);
  writeVar(other, 'mdaughter_bear_mayattack', 1);
  placeAtStand(other, kendal);
  operate(other, kendal, 'npc', 2, [], 'Another player attacks an owned Kendal');
  assert.equal(kendal.vars[id('VarNpcType', 'npc_attacking_uid')], p.uid);
  proveForeignHeroDoesNotCredit(p, other, kendal);
  goToStand(p, kendal);
  operate(p, kendal, 'npc', 2, [], 'Attack after revealing the murderer');
  damageNpc(kendal, 0); // Drain the actual combat-start damage queue before the deterministic damage probe.
  const hp = kendal.levels[NpcStat.HITPOINTS];
  damageNpc(kendal, 7);
  assert.equal(kendal.levels[NpcStat.HITPOINTS], hp - 7, 'the authorized damage queue changes real NPC HP');
  kendal.heroPoints.addHero(p.hash64, before);
  damageNpc(kendal, kendal.levels[NpcStat.HITPOINTS]);
  for (let turn = 0; turn < 40 && stage(p) !== 30; turn++) tick(p);
  assert.equal(stage(p), 30, 'the owned kill advances through the native death and player queues');
  assert.equal(count(p, 'mdaughter_bear_helmet'), 1, 'the kill grants the Bearhead trophy');
  talkTo(p, 'mdaughter_hamal');
  assert.equal(stage(p), 30, 'Hamal requires the corpse, not just the kill');
  placeAtStand(p, remains); // Travel back to the already reached cave.
  operate(p, remains, 'obj', 3, [], 'Take Asleif actual ground remains');
  assert.equal(count(p, 'mdaughter_daughter_corpse'), 1);
  assert(held(p, 'mdaughter_daughter_corpse', 3));
  finishInteraction(p, [], 'Bury before receiving instructions');
  assert.equal(stage(p), 30);
  const exit = scanLoc('mdaughter_caveexit', MAP.cave)[0];
  goToStand(p, exit);
  operate(p, exit, 'loc', 1, [], 'Leave the actual cave', true);
  assert.deepEqual(tile(p), [0, 2808, 3702], 'the cave exit lands on its packed dry approach');
  talkTo(p, 'mdaughter_hamal', [1]);
  assert.equal(stage(p), 40);
}

function useVisibleMound(p, target, label) {
  p.originX = p.x; p.originZ = p.z;
  // The packet names the map's root loc; the engine resolves its player-visible form.
  assert(locUseHandler.handle(new OpLocU(target.x, target.z, target.type, obj('mdaughter_rock'), slotOf(p, 'mdaughter_rock'), invCom), p), `${label} client item-on-loc accepted`);
  const trigger = p.getOpTrigger();
  assert.match(trigger?.name ?? '', /\[oplocu,mdaughter_burialmound\]/, `${label} resolves from the visible mound through production dispatch`);
  p.processInteraction();
  finishInteraction(p, [], label);
}

function completeBurial(p, travel, qpBefore) {
  placeAtStand(p, npc('mdaughter_hamal'));
  visitPool(p, travel, 40);
  assert(held(p, 'mdaughter_daughter_corpse', 3));
  finishInteraction(p, [], 'Bury without the necklace');
  assert.equal(stage(p), 40);
  assert.equal(count(p, 'mdaughter_daughter_corpse'), 1);
  returnToCamp(p, travel);
  talkTo(p, 'mdaughter_ragnar');
  assert.equal(count(p, 'mdaughter_necklace'), 1, 'Ragnar gives the actual burial possession');
  assert(held(p, 'mdaughter_daughter_corpse', 3));
  finishInteraction(p, [], 'Bury away from the center island');
  assert.equal(stage(p), 40);
  assert.equal(count(p, 'mdaughter_necklace'), 1);
  const rocks = scanObj('mdaughter_rock', MAP.camp, p.hash64).sort((a, b) => a.z - b.z);
  assert.equal(rocks.length, 5, 'five real rocks are available on the packed camp ground');
  for (const rock of rocks) { goToStand(p, rock); operate(p, rock, 'obj', 3, [], 'Take an actual cairn rock'); }
  assert.equal(count(p, 'mdaughter_rock'), 5);
  visitPool(p, travel, 40);
  assert(held(p, 'mdaughter_daughter_corpse', 3));
  finishInteraction(p, [], 'Bury Asleif with her necklace');
  assert.equal(stage(p), 50);
  assert.equal(count(p, 'mdaughter_daughter_corpse'), 0);
  assert.equal(count(p, 'mdaughter_necklace'), 0);
  assert.equal(readVar(p, 'mdaughter_burial_state'), 1);
  const mound = scanLoc('mdaughter_multimound')[0];
  const four = player(); // Independent reachable four-rock negative fixture; the successful route above is unseeded.
  writeVar(four, 'mdaughter_quest_var', 50);
  writeVar(four, 'mdaughter_burial_state', 1);
  seed(four, Array(4).fill('mdaughter_rock'));
  placeAtStand(four, mound, { minX: 2779, maxX: 2786, minZ: 3690, maxZ: 3696 });
  const fourXp = [four.stats[PlayerStat.ATTACK], four.stats[PlayerStat.PRAYER]];
  useVisibleMound(four, mound, 'Four rocks are not five');
  assert.equal(stage(four), 50, 'the independently sourced five-rock requirement refuses four');
  assert.equal(count(four, 'mdaughter_rock'), 4, 'a failed cairn consumes no rocks');
  assert.deepEqual([four.stats[PlayerStat.ATTACK], four.stats[PlayerStat.PRAYER]], fourXp);
  goToStand(p, mound, { minX: 2779, maxX: 2786, minZ: 3690, maxZ: 3696 });
  const before = [p.stats[PlayerStat.ATTACK], p.stats[PlayerStat.PRAYER]];
  useVisibleMound(p, mound, 'Build the five-rock cairn');
  assert.equal(stage(p), 70, 'building the cairn itself completes the quest');
  assert.equal(readVar(p, 'mdaughter_burial_state'), 2);
  assert.equal(count(p, 'mdaughter_rock'), 0);
  assert.deepEqual([p.stats[PlayerStat.ATTACK] - before[0], p.stats[PlayerStat.PRAYER] - before[1]], [10000, 20000], 'exact period XP rewards in engine tenths');
  assert.equal(readVar(p, 'qp'), qpBefore + 2, 'exact two-point reward');
  assertLoginColour(p, 0x03e0);
  const rewards = p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text);
  for (const text of ['2 Quest Points', '1000 Attack XP', '2000 Prayer XP', 'Bearhead']) assert(rewards.includes(text), `the visible completion scroll includes ${text}`);
  p.closeModal();
  const paid = [p.stats[PlayerStat.ATTACK], p.stats[PlayerStat.PRAYER], readVar(p, 'qp')];
  seed(p, ['mdaughter_rock']); // Separate post-completion duplicate-operation fixture.
  assert(useLoc(p, 'mdaughter_rock', mound));
  finishInteraction(p, [], 'Replay after the cairn is complete');
  assert.equal(stage(p), 70);
  assert.equal(count(p, 'mdaughter_rock'), 1);
  assert.deepEqual([p.stats[PlayerStat.ATTACK], p.stats[PlayerStat.PRAYER], readVar(p, 'qp')], paid, 'a replay awards no XP or quest points');
}

async function main() {
  assert.equal(contentRoot.endsWith('/content'), true);
  const p = player();
  const qpVar = ['questpoints', 'qp'].find(name => types.VarPlayerType.getId(name) >= 0);
  assert(qpVar, 'packed quest-point varp exists');
  const qpBefore = readVar(p, qpVar);
  assertLoginColour(p, 0x7c00);

  // The real cliff client action is an item-on-location dispatch; it must not consume the rope.
  seed(p, ['rope']);
  const boulder = scanLoc('mdaughter_cliff_boulder', MAP.camp)[0];
  placeAtStand(p, boulder);
  assert(useLoc(p, 'rope', boulder), 'rope-on-boulder client action accepted');
  assert.equal(count(p, 'rope'), 1, 'the abseil does not consume the rope');
  assert.deepEqual(tile(p), [0, 2766, 3663], 'the abseil uses the declared walkable cliff endpoint');
  assert(!blocked(p.level, p.x, p.z), 'cliff endpoint is walkable in packed collision');

  startQuest(p);
  const travel = travelToCenter(p);
  dispatchPoolListenFromArrival(p);
  returnToCamp(p, travel);
  assert.equal(stage(p), 10, 'return from the pool preserves the tasks stage');

  testBrundtRoutes();
  completeTasks(p, travel);
  defeatKendal(p);
  completeBurial(p, travel, qpBefore);
  console.log('PASS Mountain Daughter: native packed start, tasks, visible Kendal, owned death, burial, five-rock cairn, exact rewards, login row, and Trials coexistence.');
}

await main();
process.exit(0); // World imports own workers; no server or worker survives a successful test.
