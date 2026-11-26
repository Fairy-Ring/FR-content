import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { World, State, Scripts, types, id, player, proc, load } from './runtime.mjs';

const content = path.resolve(import.meta.dirname, '../..');
const map = await load('engine/GameMap.ts');
const Trigger = (await load('engine/script/ServerTriggerType.ts')).default;
const OpLoc = (await load('network/game/client/model/OpLoc.ts')).default;
const handler = new ((await load('network/game/client/handler/OpLocHandler.ts')).default)();
const Environment = (await load('util/Environment.ts')).default;
const questConstants = fs.readFileSync(path.join(content, 'scripts/general/configs/quest.constant'), 'utf8');
const treeConstants = fs.readFileSync(path.join(content, 'scripts/areas/area_gnome/configs/spirit_tree.constant'), 'utf8');

function completion(name) {
  const value = questConstants.match(new RegExp(`^\\^${name} = (\\d+)$`, 'm'));
  assert(value, `current quest completion constant ${name}`);
  return Number(value[1]);
}
function destination(name) {
  const value = treeConstants.match(new RegExp(`^\\^${name} = (\\d+)_(\\d+)_(\\d+)_(\\d+)_(\\d+)$`, 'm'));
  assert(value, `current spirit destination constant ${name}`);
  const [, level, mx, mz, x, z] = value.map(Number);
  return { level, x: mx * 64 + x, z: mz * 64 + z };
}
const position = p => ({ level: p.level, x: p.x, z: p.z });

function nativeTrees(names = ['ent', 'stronghold_ent', 'spirit_tree']) {
  const wanted = new Set(names.map(name => id('LocType', name)));
  const found = new Map();
  for (const filename of fs.readdirSync(path.join(content, 'maps'))) {
    const square = /^m(\d+)_(\d+)\.jm2$/.exec(filename);
    if (!square) continue;
    let section;
    for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
      if (section !== 'LOC') continue;
      const row = /^([0-3]) (\d+) (\d+): (\d+)(?: \d+)?(?: \d+)?$/.exec(line);
      if (!row || !wanted.has(Number(row[4])) || found.has(Number(row[4]))) continue;
      const loc = World.getLoc(Number(square[1]) * 64 + Number(row[2]), Number(square[2]) * 64 + Number(row[3]), Number(row[1]), Number(row[4]));
      if (!loc) continue;
      const config = types.LocType.get(loc.type);
      let stand;
      for (let x = loc.x - 1; x <= loc.x + config.width && !stand; x++) {
        for (let z = loc.z - 1; z <= loc.z + config.length; z++) {
          if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z, loc.x, loc.z,
            config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) {
            stand = { x, z, level: loc.level }; break;
          }
        }
      }
      if (stand) found.set(loc.type, { loc, config, stand });
    }
    if (found.size === wanted.size) break;
  }
  assert.equal(found.size, wanted.size, 'all three original spirit trees have packed collision-clear approaches');
  return found;
}

function interact(p, tree, choices) {
  const packets = [];
  p.write = packet => packets.push(packet);
  Object.assign(p, tree.stand, { originX: tree.stand.x, originZ: tree.stand.z });
  p.clearInteraction();
  assert(handler.handle(new OpLoc(1, tree.loc.x, tree.loc.z, tree.loc.type), p), 'original Talk-to packet admitted');
  assert.equal(p.getOpTrigger(), Scripts.getByTrigger(Trigger.OPLOC1, tree.config.id, tree.config.category));
  p.processInteraction();
  const state = p.activeScript;
  assert(state, 'native dialogue pauses for its visible chat');
  const remaining = [...choices];
  for (let step = 0; state.execution !== State.FINISHED && step < 100; step++) {
    if (state.execution === State.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
    } else {
      assert.equal(state.execution, State.PAUSEBUTTON, 'original spirit dialogue does not abort');
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) {
        assert(remaining.length, `${root} has an expected original option`);
        p.lastCom = id('Component', `${root}:com_${remaining.shift()}`);
        assert(p.resumeButtons.includes(p.lastCom), 'the selected original option is visible');
      }
    }
    p.executeScript(state, true, true);
  }
  assert.equal(state.execution, State.FINISHED, 'original spirit interaction finishes');
  assert.equal(remaining.length, 0, 'only the expected original menus were offered');
  return packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ').replace(/[|\s]+/g, ' ');
}

function assertPlantedLanding(p, { loc, config }, label) {
  assert.equal(p.level, loc.level, `${label}: landing stays on the packed patch's floor`);
  const distance = (x, z) => Math.max(loc.x - x, x - (loc.x + loc.width - 1),
    loc.z - z, z - (loc.z + loc.length - 1));
  assert.equal(distance(p.x, p.z), 1, `${label}: landing is adjacent to the packed patch footprint`);
  assert(map.isZoneAllocated(p.level, p.x, p.z), `${label}: landing is in the packed map`);
  assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, `${label}: landing is walkable`);
  assert(map.reachedLoc(p.level, p.x, p.z, loc.x, loc.z, loc.width, loc.length, 1,
    loc.angle, loc.shape, config.forceapproach), `${label}: landing reaches the packed patch`);
  let escape;
  for (let x = loc.x - 8; x <= loc.x + loc.width + 8 && !escape; x++) {
    for (let z = loc.z - 8; z <= loc.z + loc.length + 8; z++) {
      if (distance(x, z) < 4) continue;
      let open = true;
      for (let dx = -1; dx <= 1 && open; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!map.isZoneAllocated(p.level, x + dx, z + dz) || map.isMapBlocked(x + dx, z + dz, p.level)) {
            open = false; break;
          }
        }
      }
      if (!open) continue;
      const route = map.findPath(p.level, p.x, p.z, x, z), end = route.at(-1);
      if (end !== undefined && ((end >>> 14) & 0x3fff) === x && (end & 0x3fff) === z) {
        escape = { x, z, waypoints: route.length }; break;
      }
    }
  }
  assert(escape, `${label}: native pathfinder finds a non-empty route out to open ground`);
  console.log(`PASS ${label}: landing ${p.x},${p.z}; packed patch ${loc.x},${loc.z}; route to open ground ${escape.x},${escape.z} (${escape.waypoints} waypoints)`);
}

export function runNativeNetworkCompatibility() {
  const trees = nativeTrees(), oldMembers = Environment.NODE_MEMBERS;
  Environment.NODE_MEMBERS = true;
  try {
    for (const [name, quest, complete, choices, target] of [
      ['ent', 'grandtree', 'grandtree_complete', [2, 1], 'village_tree'],
      ['stronghold_ent', 'treequest', 'tree_complete', [2, 1], 'khazard_tree'],
      ['spirit_tree', 'treequest', 'tree_complete', [1], 'village_tree']
    ]) {
      const p = player(), tree = trees.get(id('LocType', name));
      try {
        assert.equal(proc(p, 'farming_spirit_tree_available').intStack[0], 0, 'no planted healthy tree means no new network menu');
        const planted = types.LocType.get(id('LocType', 'farming_spirit_tree_patch_1'));
        const healthy = planted.multiloc.indexOf(id('LocType', 'spirit_tree_fullygrown'));
        assert(healthy >= 0, 'original checked spirit form has a selector byte');
        p.setVarBit(planted.multivarbit, healthy);
        assert.equal(proc(p, 'farming_spirit_tree_available').intStack[0], 1, 'healthy planted tree activates only the new network branch');
        const refused = interact(p, tree, []);
        assert.match(refused, /The tree doesn't feel like talking\./);
        assert.deepEqual(position(p), tree.stand, `${name}: original unfinished-quest refusal keeps position`);
        p.setVarBit(planted.multivarbit, 0);
        p.setVar(id('VarPlayerType', quest), completion(complete));
        const accepted = interact(p, tree, choices);
        assert.match(accepted, /spirit tree|tree talks/i);
        assert.deepEqual(position(p), destination(target), `${name}: original completed-quest destination is unchanged`);
        console.log(`PASS native ${name}: quest gate and no-planted-tree transport unchanged`);
      } finally { p.unlink(); }
    }
    const farmNames = [1, 2, 3].map(local => `farming_spirit_tree_patch_${local}`);
    const farmPatches = nativeTrees(farmNames);
    for (let local = 0; local < farmNames.length; local++) {
      const planted = types.LocType.get(id('LocType', farmNames[local]));
      const healthy = planted.multiloc.indexOf(id('LocType', 'spirit_tree_fullygrown'));
      for (let choice = 1; choice <= 5; choice++) {
        const p = player();
        try {
          p.setVar(id('VarPlayerType', 'grandtree'), completion('grandtree_complete'));
          p.setVar(id('VarPlayerType', 'treequest'), completion('tree_complete'));
          p.setVarBit(planted.multivarbit, healthy);
          const text = interact(p, trees.get(id('LocType', 'ent')), [choice]);
          assert.match(text, /planted spirit tree/i);
          if (choice === 5) {
            assertPlantedLanding(p, farmPatches.get(planted.id), `planted patch ${local + 1}`);
          } else {
            assert.deepEqual(position(p), destination(['stronghold_tree', 'village_tree', 'varrock_tree', 'khazard_tree'][choice - 1]),
              `planted patch ${local + 1}: network destination ${choice}`);
          }
        } finally { p.unlink(); }
      }
      const p = player(), tree = farmPatches.get(planted.id);
      try {
        p.setVar(id('VarPlayerType', 'grandtree'), completion('grandtree_complete'));
        p.setVar(id('VarPlayerType', 'treequest'), completion('tree_complete'));
        p.setVarBit(planted.multivarbit, healthy);
        interact(p, { ...tree, config: types.LocType.get(planted.multiloc[healthy]) }, [1]);
        assert.deepEqual(position(p), destination('stronghold_tree'), `planted patch ${local + 1}: native Talk-to enters the network`);
      } finally { p.unlink(); }
    }
    console.log('PASS all five network destinations and native Talk-to from all three planted spirit patches');
  } finally { Environment.NODE_MEMBERS = oldMembers; }
}
