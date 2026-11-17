#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseEnum, parseOptions, resolveRoots, run } from './packed.mjs';

const options = parseOptions(process.argv);
const roots = resolveRoots(options);
process.chdir(roots.engineRoot);

function u32(value) {
  return value >>> 0;
}

function readConstants(contentRoot) {
  const file = path.join(contentRoot, 'scripts/minigames/game_barrows/configs/barrows.constant');
  const values = new Map();
  for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const match = line.trim().match(/^\^([A-Za-z0-9_]+)\s*=\s*(-?\d+)\s*$/);
    if (!match) continue;
    assert(!values.has(match[1]), `${file}:${index + 1}: duplicate constant ${match[1]}`);
    values.set(match[1], Number(match[2]));
  }
  return values;
}

function readMapRows(contentRoot, filename) {
  const file = path.join(contentRoot, 'maps', filename);
  const map = /^m(\d+)_(\d+)\.jm2$/.exec(filename);
  assert(map, `${filename}: expected a packed map name`);
  const baseX = Number(map[1]) * 64;
  const baseZ = Number(map[2]) * 64;
  const floorTiles = new Set();
  const locs = [];
  let section = '';
  for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const header = /^====\s*(.*?)\s*====$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    const row = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!row) continue;
    const level = Number(row[1]);
    const localX = Number(row[2]);
    const localZ = Number(row[3]);
    const x = baseX + localX;
    const z = baseZ + localZ;
    if (section === 'MAP') {
      if (/(?:^| )(?:f\d+|u\d+|o-?\d+)(?:[; ]|$)/.test(row[4])) floorTiles.add(`${level},${x},${z}`);
      continue;
    }
    if (section !== 'LOC') continue;
    const fields = row[4].trim().split(/\s+/);
    const id = Number(fields[0]);
    if (!Number.isInteger(id)) continue;
    locs.push({
      id,
      level,
      x,
      z,
      shape: Number(fields[1] ?? 10),
      angle: Number(fields[2] ?? 0),
      line: index + 1,
      raw: row[4]
    });
  }
  return { floorTiles, locs };
}

function pointKey(point) {
  return `${point.level},${point.x},${point.z}`;
}

function manhattan(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.z - right.z);
}

function main() {
  return run(async () => {
    const runtime = await loadPackedRuntime(options);
    activeRuntime = runtime;
    const {
      World, LocType, NpcType, VarNpcType, VarPlayerType, VarBitType, ParamType, ScriptProvider, ScriptRunner, ScriptState,
      JavaRandom, CoordGrid
    } = runtime;
    const runner = createRunner(runtime, { prefix: 'barrows_topology', firstUid: 19000 });
    const { makePlayer, procInt, procVoid } = runner;
    const mapApi = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/GameMap.ts')).href);
    const route = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/routefinder/index.ts')).href);
    const { CollisionFlag, CollisionType } = route;
    const ServerTriggerType = (await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ServerTriggerType.ts')).href)).default;
    const Packet = (await import(pathToFileURL(path.join(runtime.engineRoot, 'src/io/Packet.ts')).href)).default;
    const { PlayerLoading } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/entity/PlayerLoading.ts')).href);
    const { default: VarSharedType } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/cache/config/VarSharedType.ts')).href);
    const { ScriptOpcode } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ScriptOpcode.ts')).href);
    VarSharedType.load(runtime.packDir);
    World.vars = new Int32Array(VarSharedType.count);
    activePacket = Packet;
    activePlayerLoading = PlayerLoading;

    for (const name of [
      'barrows_layout_mask', 'barrows_layout_choose', 'barrows_layout_draw', 'barrows_layout_wrong',
      'barrows_ladder_corner', 'barrows_run_begin', 'barrows_search_latch', 'barrows_run_reset',
      'barrows_resume', 'barrows_dig_dest', 'barrows_door_use', 'barrows_door_destination'
    ]) {
      assert(ScriptProvider.getByName(`[proc,${name}]`), `compiled S07 topology proc is missing: [proc,${name}]`);
    }

    // Load the real Barrows mapsquare through the native map loader. Unrelated
    // global spawn rows are not prerequisites of this bounded content fixture.
    const { unzipSync } = createRequire(path.join(runtime.engineRoot, 'package.json'))('fflate');
    const packedMaps = unzipSync(fs.readFileSync(path.join(runtime.packDir, '.cache/maps-server.zip')));
    assert(packedMaps.m55_151?.length && packedMaps.l55_151?.length, 'the real packed Barrows ground and loc maps exist');
    const packedSquare = Object.fromEntries(['m', 'l', 'n', 'o'].map(kind => [kind, packedMaps[`${kind}55_151`] ?? new Uint8Array()]));
    World.gameMap.packed.set((55 << 8) | 151, packedSquare);
    World.gameMap.zonemap.beginInitialization();
    World.gameMap.loadPackedMapsquare(packedSquare, 55 << 6, 151 << 6);
    World.gameMap.zonemap.endInitialization();

    const constants = readConstants(runtime.contentRoot);
    const constant = name => {
      assert(constants.has(name), `missing Barrows constant ^${name}`);
      return constants.get(name);
    };
    assert.equal(constant('barrows_corner_count'), 4);
    assert.equal(constant('barrows_layout_count'), 64);
    assert.equal(constant('barrows_lock_mask'), 0xffff);

    const vars = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns'].map(name => {
      const id = VarPlayerType.getId(name);
      assert.notEqual(id, -1, `missing packed player varp ${name}`);
      return [name, id];
    }));
    const corners = ['barrows_chamber_a', 'barrows_chamber_c', 'barrows_chamber_g', 'barrows_chamber_i'].map(name => {
      const id = VarBitType.getId(name);
      assert.notEqual(id, -1, `missing packed visibility varbit ${name}`);
      return id;
    });
    assert.deepEqual(corners, [465, 466, 467, 468], 'the original four ladder visibility varbits remain unchanged');
    const doors = 'abcdefghijklmnop'.split('').map(letter => {
      const name = `barrows_door_${letter}`;
      const id = VarBitType.getId(name);
      assert.notEqual(id, -1, `missing packed door varbit ${name}`);
      return id;
    });
    assert.deepEqual(doors, Array.from({ length: 16 }, (_, index) => 469 + index));

    const stateRanges = {
      identity: [constant('barrows_identity_start'), constant('barrows_identity_end')],
      phase: [constant('barrows_phase_start'), constant('barrows_phase_end')],
      corner: [constant('barrows_corner_start'), constant('barrows_corner_end')],
      entrance: [constant('barrows_entrance_start'), constant('barrows_entrance_end')],
      family: [constant('barrows_family_start'), constant('barrows_family_end')],
      permutation: [constant('barrows_permutation_start'), constant('barrows_permutation_end')]
    };
    const clientRanges = {
      ladder: [constant('barrows_ladder_start'), constant('barrows_ladder_end')],
      locks: [constant('barrows_locks_start'), constant('barrows_locks_end')],
      puzzle: [constant('barrows_puzzle_start'), constant('barrows_puzzle_end')]
    };
    const solvedBit = constant('barrows_solved_bit');
    const challengeBit = constant('barrows_challenge_bit');
    const rangeMask = (start, end) => u32((2 ** (end - start + 1) - 1) << start);
    const readRange = (word, start, end) => (u32(word) >>> start) & (2 ** (end - start + 1) - 1);
    const setRange = (word, value, start, end) => {
      const mask = rangeMask(start, end);
      return u32((u32(word) & ~mask) | ((value << start) & mask));
    };
    const stateWord = ({
      high = 0, identity = 0, phase = 0, corner = 0, entrance = 0, solved = false,
      family = 0, permutation = 0, challenge = false
    } = {}) => {
      let word = u32(high);
      for (const [key, value] of Object.entries({ identity, phase, corner, entrance, family, permutation })) {
        const [start, end] = stateRanges[key];
        word = setRange(word, value, start, end);
      }
      if (solved) word = u32(word | (1 << solvedBit));
      if (challenge) word = u32(word | (1 << challengeBit));
      return word;
    };
    const clientWord = (mask, corner, preserved = 0) => {
      let word = setRange(preserved, mask & 0xffff, ...clientRanges.locks);
      word = setRange(word, 1 << corner, ...clientRanges.ladder);
      return u32(word);
    };
    const setPlayerVar = (player, name, value) => player.setVar(vars[name], value);
    const clientLockMask = player => readRange(player.getVar(vars.barrows), ...clientRanges.locks);
    // A real delayed Dig owns protected access; inspect saved bits without
    // attempting a second protected script while that continuation is paused.
    const selectedCorner = player => player.activeScript
      ? readRange(player.getVar(vars.barrows_state), ...stateRanges.corner)
      : procInt(player, 'barrows_ladder_corner');
    const snapshotPlayer = player => ({
      client: u32(player.getVar(vars.barrows)),
      kills: u32(player.getVar(vars.barrows_kills)),
      state: u32(player.getVar(vars.barrows_state)),
      generation: u32(player.getVar(vars.barrows_generation)),
      countdowns: u32(player.getVar(vars.barrows_countdowns)),
      cornerBits: corners.map(id => player.getVarBit(id)),
      lockBits: doors.map(id => player.getVarBit(id))
    });
    const assertCorner = (player, expected, label) => {
      assert.equal(selectedCorner(player), expected, `${label}: stored ladder corner`);
      const bits = corners.map(id => player.getVarBit(id));
      assert.deepEqual(bits, corners.map((_, index) => index === expected ? 1 : 0), `${label}: exactly one original ladder visibility bit`);
      assert.equal(readRange(player.getVar(vars.barrows), ...clientRanges.ladder), 1 << expected, `${label}: native client varbits encode the selected corner`);
    };
    const assertLayout = (player, { entrance, rank, corner, phase, label }) => {
      const expectedMask = expectedLockMask(entrance, corner, rank);
      assert.equal(clientLockMask(player), expectedMask, `${label}: exact 16-bit personal lock layout`);
      assertCorner(player, corner, label);
      assert.equal(readRange(player.getVar(vars.barrows_state), ...stateRanges.entrance), entrance, `${label}: selected central entrance`);
      assert.equal(readRange(player.getVar(vars.barrows_state), ...stateRanges.phase), phase, `${label}: run phase`);
      assert.equal(player.getVarBit(doors[0]), (expectedMask & 1) ? 1 : 0, `${label}: original lock varbits use 1=locked`);
      return expectedMask;
    };

    const centralBits = [4, 8, 9, 11];
    assert.deepEqual([...parseEnum(runtime.contentRoot, 'barrows_central_lock_bit')], centralBits.map((bit, index) => [String(index), String(bit)]));

    const roomEdges = parseEnum(runtime.contentRoot, 'barrows_room_edges_by_lock');
    assert.equal(roomEdges.size, 16, 'S00 supplies exactly sixteen measured lock joins');
    const edgesByBit = Array.from({ length: 16 }, () => []);
    const edgeToBit = new Map();
    for (const [lockText, encoded] of roomEdges) {
      const lock = Number(lockText);
      const bit = lock - 469;
      assert(Number.isInteger(bit) && bit >= 0 && bit < 16, `unexpected measured lock id ${lockText}`);
      const edges = encoded.split('|');
      assert(edges.length > 0 && edges.every(edge => edge.includes('>')), `malformed room edges for lock ${lock}`);
      for (const edge of edges) {
        assert(!edgeToBit.has(edge), `measured edge ${edge} belongs to multiple lock bits`);
        edgeToBit.set(edge, bit);
        edgesByBit[bit].push(edge);
      }
    }
    const nodes = ['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se', 'north_outside', 'south_outside', 'west_outside', 'east_outside'];
    const nodeSet = new Set(nodes);
    const roomNodes = nodes.filter(node => !node.endsWith('_outside'));
    const cornerRooms = ['nw', 'ne', 'sw', 'se'];
    const exteriorNodes = ['north_outside', 'west_outside', 'east_outside', 'south_outside'];
    const corridorBitByNode = Object.fromEntries(exteriorNodes.map(node => {
      const bits = new Set(edgesByBit.flatMap((edges, bit) => edges.some(edge => edge.split('>').includes(node)) ? [bit] : []));
      assert.equal(bits.size, 1, `${node}: both measured corridor edges share one lock bit`);
      return [node, [...bits][0]];
    }));
    const exteriorBits = Object.values(corridorBitByNode);
    assert.deepEqual([...exteriorBits].sort((left, right) => left - right), [0, 1, 7, 15]);
    const cornerBits = cornerRooms.map(room => edgesByBit.flatMap((edges, bit) =>
      edges.some(edge => edge.split('>').includes(room)) ? [bit] : []
    ));
    assert(cornerBits.every(bits => bits.length === 4), 'each measured ladder room has four door edges');
    assert.equal(nodeSet.size, 13);
    assert.equal(edgeToBit.size, 20, 'the measured graph has twelve internal and eight exterior openings');
    assert.equal([...edgeToBit.keys()].filter(edge => !edge.includes('_outside')).length, 12);
    assert.equal([...edgeToBit.keys()].filter(edge => edge.includes('_outside')).length, 8);

    function graphEdges(mask) {
      const edges = new Set();
      for (let bit = 0; bit < 16; bit++) {
        if ((mask & (1 << bit)) !== 0) continue;
        for (const edge of edgesByBit[bit]) edges.add(edge);
      }
      return edges;
    }

    function reachableRooms(mask, start) {
      const adjacency = new Map(nodes.map(node => [node, new Set()]));
      for (const edge of graphEdges(mask)) {
        const [left, right] = edge.split('>');
        adjacency.get(left).add(right);
        adjacency.get(right).add(left);
      }
      const seen = new Set([start]);
      const queue = [start];
      for (let index = 0; index < queue.length; index++) {
        for (const next of adjacency.get(queue[index])) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      return new Set(roomNodes.filter(node => seen.has(node)));
    }

    function openCornerDoors(mask, corner) {
      return cornerBits[corner].filter(bit => (mask & (1 << bit)) === 0).length;
    }

    function validLayout(mask, corner, entrance) {
      const openCentral = centralBits.filter(bit => (mask & (1 << bit)) === 0);
      if (openCentral.length !== 1 || openCentral[0] !== centralBits[entrance]) return false;
      if (openCornerDoors(mask, corner) !== 1) return false;
      const reachable = reachableRooms(mask, cornerRooms[corner]);
      return reachable.size === 9 && reachable.has('center');
    }

    function assertValidLayout(mask, corner, entrance, label) {
      assert.deepEqual(
        centralBits.filter(bit => (mask & (1 << bit)) === 0),
        [centralBits[entrance]],
        `${label}: exactly the selected central edge is open`
      );
      assert.equal(openCornerDoors(mask, corner), 1, `${label}: exactly one door opens in the ladder room`);
      const reachable = reachableRooms(mask, cornerRooms[corner]);
      assert.deepEqual([...reachable].sort(), [...roomNodes].sort(), `${label}: all nine rooms connect to the ladder room`);
      assert(reachable.has('center'), `${label}: the ladder room reaches the chest room`);
    }

    // Independently enumerate every 16-bit outer mask and all four ladder
    // corners. A base row locks all central doors; each entrance then opens
    // exactly one central edge for the nine-room connectivity check.
    const validOuterMasksByCorner = Array.from({ length: 4 }, () => []);
    for (let mask = 0; mask <= 0xffff; mask++) {
      const allCentralLocked = centralBits.every(bit => (mask & (1 << bit)) !== 0);
      for (let corner = 0; corner < 4; corner++) {
        if (!allCentralLocked || openCornerDoors(mask, corner) !== 1) continue;
        let valid = true;
        for (let entrance = 0; entrance < 4; entrance++) {
          const opened = mask & ~(1 << centralBits[entrance]);
          if (!validLayout(opened, corner, entrance)) {
            valid = false;
            break;
          }
        }
        if (valid) validOuterMasksByCorner[corner].push(mask);
      }
    }
    assert.deepEqual(validOuterMasksByCorner.map(rows => rows.length), [64, 64, 64, 64], 'exhaustive 65536-mask enumeration yields 64 valid rows per ladder corner');

    const layoutLocks = parseEnum(runtime.contentRoot, 'barrows_layout_locks');
    assert.equal(layoutLocks.size, 4 * 64, 'the packed corner/rank table contains exactly 256 rows');
    const layoutMasksByCorner = Array.from({ length: 4 }, () => []);
    for (let corner = 0; corner < 4; corner++) {
      const packedRows = new Set();
      for (let rank = 0; rank < 64; rank++) {
        const key = String(corner * 64 + rank);
        assert(layoutLocks.has(key), `packed layout row ${key} exists`);
        const mask = Number(layoutLocks.get(key));
        assert(Number.isInteger(mask) && mask >= 0 && mask <= 0xffff, `packed layout row ${key} is a 16-bit mask`);
        assert(centralBits.every(bit => (mask & (1 << bit)) !== 0), `packed layout row ${key} locks all four central edges`);
        assert(!packedRows.has(mask), `corner ${corner} rank ${rank} has a unique outer mask`);
        assert(validOuterMasksByCorner[corner].includes(mask), `packed layout row ${key} satisfies independently enumerated topology`);
        packedRows.add(mask);
        layoutMasksByCorner[corner].push(mask);
      }
      assert.deepEqual(layoutMasksByCorner[corner], validOuterMasksByCorner[corner], `corner ${corner}: every packed rank matches the ascending exhaustive mask inventory`);
    }
    const layoutCorridorCounts = parseEnum(runtime.contentRoot, 'barrows_layout_corridor_count');
    assert.equal(layoutCorridorCounts.size, 16, 'the packed corridor count enum covers four corners and four exterior locks');
    for (let corner = 0; corner < 4; corner++) {
      for (const [node, bit] of Object.entries(corridorBitByNode)) {
        const key = String(corner * 16 + bit);
        const count = layoutMasksByCorner[corner].filter(mask => (mask & (1 << bit)) === 0).length;
        assert(layoutCorridorCounts.has(key), `packed corridor count row ${key} exists`);
        assert.equal(Number(layoutCorridorCounts.get(key)), count, `corner ${corner} ${node}: corridor count matches its complete valid mask set`);
        assert.equal(count, cornerBits[corner].includes(bit) ? 16 : 48, `corner ${corner} ${node}: incident/nonincident corridor count`);
      }
    }

    function expectedLockMask(entrance, corner, rank) {
      assert(Number.isInteger(entrance) && entrance >= 0 && entrance < 4, `invalid central entrance ${entrance}`);
      assert(Number.isInteger(corner) && corner >= 0 && corner < 4, `invalid ladder corner ${corner}`);
      assert(Number.isInteger(rank) && rank >= 0 && rank < 64, `invalid layout rank ${rank}`);
      return layoutMasksByCorner[corner][rank] & ~(1 << centralBits[entrance]) & 0xffff;
    }

    function eligibleLayouts({ excludedCorner = -1, excludedEntrance = -1, occupiedLock = -1 } = {}) {
      const layouts = [];
      for (let entrance = 0; entrance < 4; entrance++) {
        if (entrance === excludedEntrance) continue;
        for (let corner = 0; corner < 4; corner++) {
          if (corner === excludedCorner) continue;
          for (let rank = 0; rank < 64; rank++) {
            const outerMask = layoutMasksByCorner[corner][rank];
            if (occupiedLock !== -1 && (outerMask & (1 << occupiedLock)) !== 0) continue;
            layouts.push({ corner, entrance, rank, mask: expectedLockMask(entrance, corner, rank) });
          }
        }
      }
      return layouts;
    }

    function assertSeamBijection({ label, player, excludedCorner = -1, excludedEntrance = -1, occupiedLock = -1, point, expectedCount }) {
      const layouts = eligibleLayouts({ excludedCorner, excludedEntrance, occupiedLock });
      assert.equal(layouts.length, expectedCount, `${label}: candidate count`);
      const seen = new Set();
      player.level = point.level;
      player.x = point.x;
      player.z = point.z;
      for (let seam = 0; seam < layouts.length; seam++) {
        const expected = layouts[seam];
        const draw = withDraws([[seam, layouts.length]], () => procVoid(player, 'barrows_layout_choose', [excludedCorner, excludedEntrance]));
        assert.equal(draw.calls, 1, `${label}, seam ${seam}: chooser uses one joint uniform draw`);
        const corner = readRange(player.getVar(vars.barrows_state), ...stateRanges.corner);
        const entrance = readRange(player.getVar(vars.barrows_state), ...stateRanges.entrance);
        const mask = clientLockMask(player);
        const baseMask = mask | (1 << centralBits[entrance]);
        const rank = layoutMasksByCorner[corner].indexOf(baseMask);
        assert.deepEqual({ corner, entrance, rank, mask }, expected, `${label}, seam ${seam}: exact entrance-major/corner-major/rank mapping`);
        assertValidLayout(mask, corner, entrance, `${label}, seam ${seam}`);
        if (occupiedLock !== -1) assert.equal(mask & (1 << occupiedLock), 0, `${label}, seam ${seam}: current corridor remains open`);
        const key = `${entrance}/${corner}/${rank}`;
        assert(!seen.has(key), `${label}, seam ${seam}: chooser does not repeat a layout`);
        seen.add(key);
      }
      assert.equal(seen.size, layouts.length, `${label}: every eligible layout has exactly one seam`);
      return layouts.length;
    }

    const rankProbe = makePlayer('mask');
    const maskProbeBefore = snapshotPlayer(rankProbe);
    const expectedMasks = new Set();
    const corridorClosedCounts = Object.fromEntries(exteriorNodes.map(node => [node, 0]));
    let expectedCorridorClosedLayouts = 0;
    for (let corner = 0; corner < 4; corner++) {
      for (let entrance = 0; entrance < 4; entrance++) {
        for (const outerMask of validOuterMasksByCorner[corner]) {
          const mask = outerMask & ~(1 << centralBits[entrance]) & 0xffff;
          expectedMasks.add(mask);
          const closed = exteriorNodes.filter(node => (mask & (1 << corridorBitByNode[node])) !== 0);
          if (closed.length) expectedCorridorClosedLayouts++;
          for (const node of closed) corridorClosedCounts[node]++;
        }
      }
    }

    const actualMasks = new Set();
    const masksByCornerEntrance = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => new Set()));
    const actualCorridorClosedCounts = Object.fromEntries(exteriorNodes.map(node => [node, 0]));
    let actualCorridorClosedLayouts = 0;
    let cornerTaggedLayouts = 0;
    const maskMeasure = (() => {
      const original = JavaRandom.nextDouble;
      let calls = 0;
      JavaRandom.nextDouble = function () {
        calls++;
        return original.call(this);
      };
      try {
        for (let corner = 0; corner < 4; corner++) {
          for (let entrance = 0; entrance < 4; entrance++) {
            for (let rank = 0; rank < 64; rank++) {
              const label = `corner=${corner}, entrance=${entrance}, rank=${rank}`;
              const expectedMask = expectedLockMask(entrance, corner, rank);
              const actualMask = procInt(rankProbe, 'barrows_layout_mask', [entrance, corner, rank]);
              assert(Number.isInteger(actualMask) && actualMask >= 0 && actualMask <= 0xffff, `${label}: result is a 16-bit unsigned lock mask`);
              assert.equal(actualMask, expectedMask, `${label}: exact packed outer mask plus selected central opening`);
              assert.deepEqual([...graphEdges(actualMask)].sort(), [...graphEdges(expectedMask)].sort(), `${label}: graph edges exactly match measured lock joins`);
              assertValidLayout(actualMask, corner, entrance, label);
              actualMasks.add(actualMask);
              masksByCornerEntrance[corner][entrance].add(actualMask);
              cornerTaggedLayouts++;
              const closed = exteriorNodes.filter(node => (actualMask & (1 << corridorBitByNode[node])) !== 0);
              if (closed.length) actualCorridorClosedLayouts++;
              for (const node of closed) actualCorridorClosedCounts[node]++;
            }
          }
        }
        return calls;
      } finally {
        JavaRandom.nextDouble = original;
      }
    })();
    assert.equal(maskMeasure, 0, 'the pure layout-mask proc must never draw randomness');
    assert.equal(cornerTaggedLayouts, 4 * 4 * 64, 'all 1024 corner-tagged layouts are checked');
    assert.equal(actualMasks.size, 1024, 'the 1024 corner-tagged layouts have 1024 unique masks');
    assert.deepEqual(masksByCornerEntrance.map(corners => corners.map(masks => masks.size)), Array.from({ length: 4 }, () => [64, 64, 64, 64]), 'each corner and entrance has all 64 ranks');
    assert.deepEqual([...actualMasks].sort((left, right) => left - right), [...expectedMasks].sort((left, right) => left - right), 'the packed mask proc produces the complete independently enumerated mask set');
    assert.equal(actualCorridorClosedLayouts, expectedCorridorClosedLayouts, 'corridor-closed layout count matches exhaustive enumeration');
    assert.deepEqual(actualCorridorClosedCounts, corridorClosedCounts, 'each exterior corridor closed count matches exhaustive enumeration');
    assert.deepEqual(snapshotPlayer(rankProbe), maskProbeBefore, 'layout_mask changes no player varp or native varbit');

    const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
    const nodeGrid = {
      nw: [0, 0], n: [1, 0], ne: [2, 0],
      w: [0, 1], center: [1, 1], e: [2, 1],
      sw: [0, 2], s: [1, 2], se: [2, 2],
      north_outside: [1, -1], south_outside: [1, 3], west_outside: [-1, 1], east_outside: [3, 1]
    };
    const canonicalEdge = (left, right) => nodeIndex.get(left) < nodeIndex.get(right) ? `${left}>${right}` : `${right}>${left}`;
    const rotateNode = node => {
      const [x, y] = nodeGrid[node];
      const target = [2 - y, x];
      const result = Object.entries(nodeGrid).find(([, point]) => point[0] === target[0] && point[1] === target[1]);
      assert(result, `rotation must map ${node} to a measured room`);
      return result[0];
    };
    const rotateMask = mask => {
      let rotated = 0xffff;
      for (let bit = 0; bit < 16; bit++) {
        const targets = new Set(edgesByBit[bit].map(edge => {
          const [left, right] = edge.split('>');
          const mapped = canonicalEdge(rotateNode(left), rotateNode(right));
          assert(edgeToBit.has(mapped), `rotated measured edge ${mapped} must exist`);
          return edgeToBit.get(mapped);
        }));
        assert.equal(targets.size, 1, `rotating lock bit ${bit} maps its measured edge group to one lock`);
        const targetBit = [...targets][0];
        if ((mask & (1 << bit)) === 0) rotated &= ~(1 << targetBit);
      }
      return rotated & 0xffff;
    };
    for (const mask of actualMasks) {
      assert(actualMasks.has(rotateMask(mask)), `layout ${mask.toString(16)} has a 90-degree rotation in the finite layout set`);
    }

    const stalePlayer = makePlayer('transitions', 0, 3565, 3289);
    const otherPlayer = makePlayer('transition-peer');
    const initialHigh = 0xa55a0000;
    setPlayerVar(stalePlayer, 'barrows', clientWord(0x5a3c, 3, 0x91234567));
    setPlayerVar(stalePlayer, 'barrows_kills', 0xfedcba98);
    setPlayerVar(stalePlayer, 'barrows_state', stateWord({ high: initialHigh, identity: 6, phase: 0, corner: 3, entrance: 2, solved: true, family: 3, permutation: 5, challenge: true }));
    setPlayerVar(stalePlayer, 'barrows_generation', 41);
    setPlayerVar(stalePlayer, 'barrows_countdowns', 0x81234567);
    setPlayerVar(otherPlayer, 'barrows', clientWord(0xaaaa, 2, 0x3456789a));
    setPlayerVar(otherPlayer, 'barrows_state', stateWord({ high: 0x7bcd0000, identity: 2, phase: 1, corner: 2, entrance: 3 }));
    setPlayerVar(otherPlayer, 'barrows_generation', 41);
    setPlayerVar(otherPlayer, 'barrows_kills', 0x12345678);
    setPlayerVar(otherPlayer, 'barrows_countdowns', 0xabcdef01);
    const peerBeforeBegin = snapshotPlayer(otherPlayer);

    const beginCorner = 0;
    const beginEntrance = 1;
    const beginRank = 63;
    const surface = { level: 0, x: 55 * 64 + 45, z: 51 * 64 + 25 };
    const destination = CoordGrid.packCoord(3, 55 * 64 + 37, 151 * 64 + 39);
    assert.deepEqual([stalePlayer.level, stalePlayer.x, stalePlayer.z], [surface.level, surface.x, surface.z]);
    const entryWrites = [];
    const originalEntryOpen = stalePlayer.openMainOverlay;
    stalePlayer.openMainOverlay = function (component) {
      if (component === runtime.Component.getId('kill_count')) entryWrites.push(snapshotPlayer(this));
      return originalEntryOpen.call(this, component);
    };
    const entryDraw = withDraws([[4, 6], [255, 576]], () => startSuspendedProc(stalePlayer, 'barrows_dig_dest', [destination]));
    assert.equal(entryDraw.calls, 2, 'run begin consumes an identity draw and one global layout-seam draw');
    const entryState = entryDraw.value;
    assert.equal(stalePlayer.level, surface.level, 'the tunnel view is not entered before the delayed Dig continuation');
    assert.deepEqual([stalePlayer.x, stalePlayer.z], [surface.x, surface.z]);
    const beginMask = assertLayout(stalePlayer, { entrance: beginEntrance, rank: beginRank, corner: beginCorner, phase: 1, label: 'run begin before descent' });
    assert.notEqual(beginCorner, 3, 'run begin excludes the previous ladder corner');
    assert.notEqual(beginEntrance, 2, 'run begin excludes the previous central entrance');
    assert.equal(readRange(stalePlayer.getVar(vars.barrows_state), 16, 31), initialHigh >>> 16, 'run begin preserves unassigned high state bits');
    assert.equal(readRange(stalePlayer.getVar(vars.barrows_state), ...stateRanges.identity), 5, 'run begin uses its first controlled identity draw');
    assert.equal(u32(stalePlayer.getVar(vars.barrows_generation)), 42, 'run begin advances only its owner generation');
    assert.deepEqual(snapshotPlayer(otherPlayer), peerBeforeBegin, 'run begin leaves a second player untouched');
    assert.equal(entryState.execution, ScriptState.SUSPENDED, 'the product Dig continuation suspends only at its real delay');
    World.currentTick = Math.max(World.currentTick + 1, stalePlayer.delayedUntil);
    stalePlayer.delayed = false;
    stalePlayer.executeScript(entryState, true, true);
    assert.equal(entryState.execution, ScriptState.FINISHED, 'the compiled Dig continuation completes after its delay');
    assert.equal(stalePlayer.activeScript, null);
    assert.equal(stalePlayer.protect, false);
    assert.deepEqual([stalePlayer.level, stalePlayer.x, stalePlayer.z], [3, 55 * 64 + 37, 151 * 64 + 39], 'the compiled Dig continuation transfers to its joined crypt entry');
    assert(entryWrites.length > 0, 'the compiled tunnel entry requests its original HUD after the delay');
    for (const write of entryWrites) {
      assert.equal(readRange(write.client, ...clientRanges.locks), beginMask, 'every tunnel-view write follows the complete personal lock layout');
      assert.deepEqual(write.cornerBits, corners.map((_, index) => index === beginCorner ? 1 : 0), 'every tunnel-view write follows the selected ladder visibility bit');
    }
    stalePlayer.openMainOverlay = originalEntryOpen;
    assertCorner(stalePlayer, beginCorner, 'run begin');

    const beforeResume = snapshotPlayer(stalePlayer);
    const resumeCalls = withNoRandom(() => procVoid(stalePlayer, 'barrows_resume'));
    assert.equal(resumeCalls.calls, 0, 'derived resume reconciliation never draws a layout');
    assert.deepEqual(snapshotPlayer(stalePlayer), beforeResume, 'resume preserves the stored lock mask, corner, phase and generation');

    const loadedForRelog = restorePlayer(stalePlayer);
    const savedLayout = snapshotPlayer(loadedForRelog);
    assert.deepEqual(savedLayout, snapshotPlayer(stalePlayer), 'native player save/load retains the stored layout and varbits');
    const loginTrigger = ScriptProvider.getByTriggerSpecific(ServerTriggerType.LOGIN, -1, -1);
    const logoutTrigger = ScriptProvider.getByTriggerSpecific(ServerTriggerType.LOGOUT, -1, -1);
    assert(loginTrigger, 'the compiled global LOGIN server trigger is available');
    assert(logoutTrigger, 'the compiled global LOGOUT server trigger is available');
    const loginRun = withNoRandom(() => runNativeTrigger(loadedForRelog, loginTrigger, 'LOGIN'));
    assert.equal(loginRun.calls, 0, 'the native LOGIN server trigger never redraws a stored layout');
    assert.deepEqual(snapshotPlayer(loadedForRelog), savedLayout, 'native LOGIN/resume reconciliation preserves locks, corner and generation');
    const logoutRun = withNoRandom(() => runNativeTrigger(loadedForRelog, logoutTrigger, 'LOGOUT'));
    assert.equal(logoutRun.calls, 0, 'the native LOGOUT server trigger never redraws a stored layout');
    assert.deepEqual(snapshotPlayer(loadedForRelog), savedLayout, 'native LOGOUT preserves the saved personal layout');
    const loadedAfterLogout = restorePlayer(loadedForRelog);
    assert.deepEqual(snapshotPlayer(loadedAfterLogout), savedLayout, 'a second native save/load round trip retains layout after logout');

    stalePlayer.level = 0;
    stalePlayer.x = 3552;
    stalePlayer.z = 9696;
    const runGeneration = u32(stalePlayer.getVar(vars.barrows_generation));
    const staleBefore = snapshotPlayer(stalePlayer);
    const staleWrong = withNoRandom(() => procInt(stalePlayer, 'barrows_layout_wrong', [runGeneration + 1]));
    assert.equal(staleWrong.calls, 0, 'a stale wrong-answer generation consumes no randomness');
    assert.equal(staleWrong.value, 0, 'a stale wrong-answer generation is refused');
    assert.deepEqual(snapshotPlayer(stalePlayer), staleBefore, 'a stale wrong-answer generation changes no durable state or varbits');
    const outOfTunnels = { level: stalePlayer.level, x: stalePlayer.x, z: stalePlayer.z };
    stalePlayer.level = 3;
    const outsideBefore = snapshotPlayer(stalePlayer);
    const outsideWrong = withNoRandom(() => procInt(stalePlayer, 'barrows_layout_wrong', [runGeneration]));
    assert.equal(outsideWrong.value, 0, 'a correct-generation wrong answer outside the tunnels is refused');
    assert.deepEqual(snapshotPlayer(stalePlayer), outsideBefore, 'the location guard changes no state');
    stalePlayer.level = outOfTunnels.level;
    stalePlayer.x = outOfTunnels.x;
    stalePlayer.z = outOfTunnels.z;

    const wrongCorner = 1;
    const wrongOldEntrance = readRange(stalePlayer.getVar(vars.barrows_state), ...stateRanges.entrance);
    const wrongEntrance = 2;
    const wrongRank = 63;
    const wrongEntranceIndex = [0, 1, 2, 3].filter(entrance => entrance !== wrongOldEntrance).indexOf(wrongEntrance);
    assert.notEqual(wrongEntranceIndex, -1, 'wrong-answer seam selects an entrance other than the previous one');
    const wrongSeam = (wrongEntranceIndex * 4 + wrongCorner) * 64 + wrongRank;
    const wrongDraw = withDraws([[wrongSeam, 768]], () => procInt(stalePlayer, 'barrows_layout_wrong', [runGeneration]));
    assert.equal(wrongDraw.calls, 1, 'a valid wrong answer draws one global eligible-layout seam');
    assert.equal(wrongDraw.value, 1, 'a current-generation wrong answer is accepted');
    assert.notEqual(wrongEntrance, wrongOldEntrance, 'the seeded wrong-answer central edge differs from the old edge');
    assertLayout(stalePlayer, { entrance: wrongEntrance, rank: wrongRank, corner: wrongCorner, phase: 1, label: 'wrong-answer transition' });
    assert.equal(u32(stalePlayer.getVar(vars.barrows_generation)), runGeneration, 'wrong answer does not advance the run generation');
    assert.equal(procInt(stalePlayer, 'barrows_tunnel_identity'), 5, 'wrong answer preserves the selected tunnel identity');
    assert.equal(u32(stalePlayer.getVar(vars.barrows_state)) & (0x7f << solvedBit), 0, 'wrong answer clears solved and all puzzle interaction fields');
    assert.equal(u32(stalePlayer.getVar(vars.barrows)) & rangeMask(...clientRanges.puzzle), 0, 'wrong answer clears the original puzzle presentation bits');
    assertCorner(stalePlayer, wrongCorner, 'wrong-answer transition');

    const searchClientBefore = u32(stalePlayer.getVar(vars.barrows) | rangeMask(...clientRanges.puzzle));
    const searchStateBefore = u32(stalePlayer.getVar(vars.barrows_state) | rangeMask(solvedBit, challengeBit));
    setPlayerVar(stalePlayer, 'barrows', searchClientBefore);
    setPlayerVar(stalePlayer, 'barrows_state', searchStateBefore);
    const searchCorner = readRange(searchStateBefore, ...stateRanges.corner);
    const searchEntrance = readRange(searchStateBefore, ...stateRanges.entrance);
    const searchMask = readRange(searchClientBefore, ...clientRanges.locks);
    const searchDraw = withNoRandom(() => procInt(stalePlayer, 'barrows_search_latch', [runGeneration]));
    assert.equal(searchDraw.calls, 0, 'successful Search advances phase and generation without drawing a layout');
    assert.equal(searchDraw.value, 1, 'a current-generation Search latch is accepted');
    assert.equal(u32(stalePlayer.getVar(vars.barrows)), searchClientBefore, 'Search preserves all 32 bits of original varp 452');
    assert.equal(readRange(stalePlayer.getVar(vars.barrows_state), ...stateRanges.corner), searchCorner, 'Search preserves the ladder-corner selector');
    assert.equal(readRange(stalePlayer.getVar(vars.barrows_state), ...stateRanges.entrance), searchEntrance, 'Search preserves the central-door selector');
    assert.equal(clientLockMask(stalePlayer), searchMask, 'Search preserves the current personal lock layout without redrawing');
    assert.equal(u32(stalePlayer.getVar(vars.barrows_generation)), runGeneration + 1, 'Search advances the owner generation without storing a new layout');
    assert.equal(u32(stalePlayer.getVar(vars.barrows_state)) & rangeMask(solvedBit, challengeBit), 0, 'Search clears solved and all challenge fields');
    assert.equal(procInt(stalePlayer, 'barrows_tunnel_identity'), 5, 'Search preserves the tunnel identity');
    assertCorner(stalePlayer, searchCorner, 'successful Search transition');
    const staleSearch = withNoRandom(() => procInt(stalePlayer, 'barrows_search_latch', [runGeneration]));
    assert.equal(staleSearch.calls, 0, 'stale Search consumes no randomness');
    assert.equal(staleSearch.value, 0, 'stale Search is refused');
    assert.equal(clientLockMask(stalePlayer), searchMask, 'stale Search preserves the escape layout');

    const resetCorner = searchCorner;
    const resetEntrance = searchEntrance;
    const resetRank = 0;
    const resetWrites = [];
    const originalResetOpen = stalePlayer.openMainOverlay;
    stalePlayer.openMainOverlay = function (component) {
      resetWrites.push(snapshotPlayer(this));
      return originalResetOpen.call(this, component);
    };
    const resetDraw = withDraws([[resetRank, 64]], () => procVoid(stalePlayer, 'barrows_run_reset'));
    assert.equal(resetDraw.calls, 1, 'paid reset retains its corner and central door and draws one replacement rank');
    stalePlayer.openMainOverlay = originalResetOpen;
    assert(resetWrites.length > 0, 'paid reset reaches its original HUD close after drawing the idle layout');
    const resetMask = assertLayout(stalePlayer, { entrance: resetEntrance, rank: resetRank, corner: resetCorner, phase: 0, label: 'paid reset transition' });
    assert.equal(u32(stalePlayer.getVar(vars.barrows_generation)), runGeneration + 2, 'paid reset advances the generation');
    assert.equal(procInt(stalePlayer, 'barrows_tunnel_identity'), 0, 'idle reset clears the previous tunnel identity');
    assert.equal(u32(stalePlayer.getVar(vars.barrows_state)) & 0xffff, (resetCorner << stateRanges.corner[0]) | (resetEntrance << stateRanges.entrance[0]), 'paid reset clears run fields and retains the previous corner and entrance selectors');
    assert.equal(u32(stalePlayer.getVar(vars.barrows_state)) & 0xffff0000, initialHigh & 0xffff0000, 'paid reset preserves unassigned high state bits');
    assert.equal(u32(stalePlayer.getVar(vars.barrows)) & rangeMask(...clientRanges.puzzle), 0, 'paid reset clears the original puzzle presentation bits');
    for (const write of resetWrites) {
      assert.equal(readRange(write.client, ...clientRanges.locks), resetMask, 'reset presentation is emitted only after the idle lock layout is stored');
      assert.deepEqual(write.cornerBits, corners.map((_, index) => index === resetCorner ? 1 : 0), 'reset presentation is emitted only after the retained corner is stored');
    }
    assertCorner(stalePlayer, resetCorner, 'paid reset transition');
    assert.deepEqual(snapshotPlayer(otherPlayer), peerBeforeBegin, 'begin, wrong answer, Search, reset and resume never write another player');
    const unconstrainedSeamCount = assertSeamBijection({
      label: 'unconstrained chooser',
      player: makePlayer('all-layout-seams'),
      point: { level: 0, x: 3565, z: 3289 },
      expectedCount: 1024
    });
    const excludedSeamCount = assertSeamBijection({
      label: 'R2 chooser exclusions',
      player: makePlayer('excluded-layout-seams'),
      excludedCorner: 1,
      excludedEntrance: 2,
      point: { level: 0, x: 3565, z: 3289 },
      expectedCount: 576
    });
    assert.equal(unconstrainedSeamCount, 1024, 'uniform unconstrained seams cover every corner, entrance and rank once');
    assert.equal(excludedSeamCount, 576, 'R2 exclusions remove exactly one corner and one entrance');
    const generationZeroPlayer = makePlayer('generation-zero-no-exclusions', 0, 3565, 3289);
    setPlayerVar(generationZeroPlayer, 'barrows_state', stateWord({ phase: 0, corner: 3, entrance: 2 }));
    setPlayerVar(generationZeroPlayer, 'barrows_generation', 0);
    const generationZeroBegin = withDraws([[0, 6], [704, 1024]], () => procInt(generationZeroPlayer, 'barrows_run_begin'));
    assert.equal(generationZeroBegin.calls, 2, 'generation-zero begin draws identity and one unconstrained global seam');
    assert.equal(generationZeroBegin.value, 1, 'generation-zero begin succeeds');
    assertLayout(generationZeroPlayer, { corner: 3, entrance: 2, rank: 0, phase: 1, label: 'generation-zero no-exclusion transition' });
    let cyclePlayer = makePlayer('r2-consecutive-runs');
    setPlayerVar(cyclePlayer, 'barrows_state', stateWord({ phase: 0 }));
    setPlayerVar(cyclePlayer, 'barrows_generation', 0);
    JavaRandom.setSeed(0x377b02);
    let previousSelectors = null;
    for (let cycle = 0; cycle < 64; cycle++) {
      const begin = withNoRandom(() => procInt(cyclePlayer, 'barrows_run_begin'));
      assert.equal(begin.calls, 2, `R2 cycle ${cycle}: begin draws identity and one layout seam`);
      assert.equal(begin.value, 1, `R2 cycle ${cycle}: begin succeeds`);
      const corner = readRange(cyclePlayer.getVar(vars.barrows_state), ...stateRanges.corner);
      const entrance = readRange(cyclePlayer.getVar(vars.barrows_state), ...stateRanges.entrance);
      if (previousSelectors) {
        assert.notEqual(corner, previousSelectors.corner, `R2 cycle ${cycle}: begin excludes the previous ladder corner`);
        assert.notEqual(entrance, previousSelectors.entrance, `R2 cycle ${cycle}: begin excludes the previous central entrance`);
      }
      const mask = clientLockMask(cyclePlayer);
      assertValidLayout(mask, corner, entrance, `R2 cycle ${cycle} begin`);
      const baseMask = mask | (1 << centralBits[entrance]);
      assert(layoutMasksByCorner[corner].includes(baseMask), `R2 cycle ${cycle}: begin stores one of the packed ranks`);

      const generation = u32(cyclePlayer.getVar(vars.barrows_generation));
      const clientBeforeLatch = u32(cyclePlayer.getVar(vars.barrows));
      const latch = withNoRandom(() => procInt(cyclePlayer, 'barrows_search_latch', [generation]));
      assert.equal(latch.calls, 0, `R2 cycle ${cycle}: packed Search latch draws no layout`);
      assert.equal(latch.value, 1, `R2 cycle ${cycle}: packed Search latch succeeds`);
      assert.equal(u32(cyclePlayer.getVar(vars.barrows)), clientBeforeLatch, `R2 cycle ${cycle}: latch preserves varp 452`);
      assert.equal(readRange(cyclePlayer.getVar(vars.barrows_state), ...stateRanges.corner), corner, `R2 cycle ${cycle}: latch preserves corner`);
      assert.equal(readRange(cyclePlayer.getVar(vars.barrows_state), ...stateRanges.entrance), entrance, `R2 cycle ${cycle}: latch preserves entrance`);

      const reset = withNoRandom(() => procVoid(cyclePlayer, 'barrows_run_reset'));
      assert.equal(reset.calls, 1, `R2 cycle ${cycle}: reset draws one replacement layout seam`);
      assert.equal(readRange(cyclePlayer.getVar(vars.barrows_state), ...stateRanges.corner), corner, `R2 cycle ${cycle}: reset retains the previous corner selector`);
      assert.equal(readRange(cyclePlayer.getVar(vars.barrows_state), ...stateRanges.entrance), entrance, `R2 cycle ${cycle}: reset retains the previous entrance selector`);

      const resetSnapshot = snapshotPlayer(cyclePlayer);
      const savedBeforeLogout = restorePlayer(cyclePlayer);
      assert.deepEqual(snapshotPlayer(savedBeforeLogout), resetSnapshot, `R2 cycle ${cycle}: native Player.save/load retains exclusion selectors`);
      const logout = withNoRandom(() => runNativeTrigger(savedBeforeLogout, logoutTrigger, `R2 cycle ${cycle} LOGOUT`));
      assert.equal(logout.calls, 0, `R2 cycle ${cycle}: clean logout draws no layout`);
      assert.deepEqual(snapshotPlayer(savedBeforeLogout), resetSnapshot, `R2 cycle ${cycle}: logout keeps the idle layout selectors`);
      const savedAfterLogout = restorePlayer(savedBeforeLogout);
      const login = withNoRandom(() => runNativeTrigger(savedAfterLogout, loginTrigger, `R2 cycle ${cycle} LOGIN`));
      assert.equal(login.calls, 0, `R2 cycle ${cycle}: clean login draws no layout`);
      assert.deepEqual(snapshotPlayer(savedAfterLogout), resetSnapshot, `R2 cycle ${cycle}: relog retains exclusion selectors`);
      cyclePlayer = savedAfterLogout;
      previousSelectors = { corner, entrance };
    }


    const mapInventory = readMapRows(runtime.contentRoot, 'm55_151.jm2');
    const roomGrid = [['nw', 'n', 'ne'], ['w', 'center', 'e'], ['sw', 's', 'se']];
    const landmark = name => {
      const id = LocType.getId(name);
      assert.notEqual(id, -1, `missing packed landmark ${name}`);
      const matches = mapInventory.locs.filter(row => row.id === id && row.level === 0);
      assert.equal(matches.length, 1, `the original map has exactly one ${name}`);
      return matches[0];
    };
    const cornerLocs = ['a', 'c', 'g', 'i'].map(letter => landmark(`barrows_ladder_${letter}`));
    const chestLoc = landmark('barrows_stone_chest');
    const columns = [Math.min(...cornerLocs.map(row => row.x)), chestLoc.x, Math.max(...cornerLocs.map(row => row.x))];
    const zRows = [Math.max(...cornerLocs.map(row => row.z)), chestLoc.z, Math.min(...cornerLocs.map(row => row.z))];
    edgeAt.columns = columns;
    edgeAt.rows = zRows;
    assert.equal(columns[1] - columns[0], columns[2] - columns[1], 'the original room columns are measured from map landmarks');
    assert.equal(zRows[0] - zRows[1], zRows[1] - zRows[2], 'the original room rows are measured from map landmarks');
    const roomPoints = {};
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        roomPoints[roomGrid[row][column]] = { level: 0, x: columns[column], z: zRows[row] };
      }
    }
    roomPoints.north_outside = { level: 0, x: chestLoc.x, z: zRows[0] + 6 };
    roomPoints.south_outside = { level: 0, x: chestLoc.x, z: zRows[2] - 6 };
    roomPoints.west_outside = { level: 0, x: columns[0] - 6, z: chestLoc.z };
    roomPoints.east_outside = { level: 0, x: columns[2] + 6, z: chestLoc.z };
    const roomEdgesForLock = new Map([...roomEdges].map(([lock, list]) => [Number(lock), list.split('|')]));
    const edgeRows = new Map();
    const expectedParentNames = new Set('abcdefghijklmnop'.split('').flatMap(letter => [`barrows_door_${letter}_r`, `barrows_door_${letter}_l`]));
    const doorRows = mapInventory.locs.filter(row => /^barrows_door_[a-p]_[rl]$/.test(LocType.get(row.id)?.debugname ?? '')).map(row => {
      const parent = LocType.get(row.id);
      const nameMatch = /^barrows_door_([a-p])_([rl])$/.exec(parent.debugname);
      assert(nameMatch, `map line ${row.line}: parent loc has a measured Barrows door identity`);
      const [, letter, side] = nameMatch;
      const lockParam = ParamType.getId('barrows_room_edge_lock');
      assert.notEqual(lockParam, -1, 'packed loc params expose the measured room-edge lock');
      const lock = parent.params?.get(lockParam);
      assert.equal(typeof lock, 'number', `${parent.name}: packed parent carries an integer lock param`);
      const lockBit = lock - 469;
      assert(lockBit >= 0 && lockBit < 16, `${parent.name}: lock param is one of the original sixteen bits`);
      assert.equal(parent.multivarbit, VarBitType.getId(`barrows_door_${letter}`), `${parent.name}: native parent multi-varbit matches its own lock`);
      assert.equal(VarBitType.getId(`barrows_door_${letter}`), lock, `${parent.name}: packed varbit id matches its measured lock param`);
      assert.equal(parent.multiloc.length, 2, `${parent.name}: parent has exactly the original 0/1 visual children`);
      const openChild = LocType.get(parent.multiloc[0]);
      const lockedChild = LocType.get(parent.multiloc[1]);
      assert.equal(openChild.debugname, `barrows_door_unlocked_${side}`, `${parent.debugname}: state 0 resolves to its unlocked child`);
      assert.equal(lockedChild.debugname, `barrows_door_locked_${side}`, `${parent.debugname}: state 1 resolves to its locked child`);
      const edge = edgeAt(row);
      assert(roomEdgesForLock.get(lock)?.includes(edge), `${parent.name} at map line ${row.line}: packed parent lock joins the measured edge ${edge}`);
      const loc = World.getLoc(row.x, row.z, row.level, row.id);
      assert(loc, `${parent.name} at ${row.x},${row.z}: original map loc is loaded by the engine`);
      assert.equal(loc.baseType, row.id, `${parent.name}: original loaded loc retains the parent identity`);
      assert.equal(loc.baseShape, row.shape, `${parent.name}: original map shape is loaded`);
      assert.equal(loc.baseAngle, row.angle, `${parent.name}: original map rotation is loaded`);
      const xSeparated = Math.abs(roomPoints[edge.split('>')[0]].x - roomPoints[edge.split('>')[1]].x) > 0;
      const outside = edge.split('>').find(node => node.endsWith('_outside'));
      const axis = outside
        ? (outside.startsWith('north_') || outside.startsWith('south_') ? 'z' : 'x')
        : (xSeparated ? 'x' : 'z');
      const laneAxis = axis === 'x' ? 'z' : 'x';
      const placement = { ...row, name: parent.debugname, letter, side, lock, lockBit, edge, axis, laneAxis, parent, loc };
      const rowsForEdge = edgeRows.get(edge) ?? [];
      rowsForEdge.push(placement);
      edgeRows.set(edge, rowsForEdge);
      return placement;
    });
    assert.equal(doorRows.length, 64, 'all 64 actual measured Barrows door parent placements are loaded from the original map inventory');
    assert.deepEqual(new Set(doorRows.map(row => row.name)), expectedParentNames, 'all 32 original right/left parent loc types are represented');
    assert.equal(edgeRows.size, 20, 'all twenty measured door edges have original map placements');
    assert.deepEqual([...edgeRows.keys()].sort(), [...edgeToBit.keys()].sort(), 'the original 64 placements cover exactly the measured edge inventory');

    World.currentTick = Math.max(World.currentTick, 100);
    assert(World.gameMap.getTotalLocs() >= 64, 'the engine loaded original map locs before collision/path assertions');
    const tileWalkable = point => mapInventory.floorTiles.has(pointKey(point))
      && !mapApi.isMapBlocked(point.x, point.z, point.level)
      && route.isZoneAllocated(point.x, point.z, point.level);
    const nodeBounds = {};
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        const node = roomGrid[row][column];
        const point = roomPoints[node];
        nodeBounds[node] = { minX: point.x - 6, maxX: point.x + 6, minZ: point.z - 6, maxZ: point.z + 6 };
      }
    }
    nodeBounds.north_outside = { minX: columns[0] - 2, maxX: columns[2] + 2, minZ: zRows[0] + 6, maxZ: zRows[0] + 8 };
    nodeBounds.south_outside = { minX: columns[0] - 2, maxX: columns[2] + 2, minZ: zRows[2] - 8, maxZ: zRows[2] - 7 };
    nodeBounds.west_outside = { minX: columns[0] - 8, maxX: columns[0] - 6, minZ: zRows[2] - 2, maxZ: zRows[0] + 2 };
    nodeBounds.east_outside = { minX: columns[2] + 7, maxX: columns[2] + 8, minZ: zRows[2] - 2, maxZ: zRows[0] + 2 };
    const withinBounds = (point, bounds) => point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ;
    const nativeRoute = (start, finish) => {
      if (start.level !== finish.level) return false;
      if (start.x === finish.x && start.z === finish.z) return true;
      return route.findPath(start.level, start.x, start.z, finish.x, finish.z, 1, 1, 1, 0, -1, false, 0, 64, CollisionType.NORMAL).length > 0;
    };
    const findNodeAnchor = node => {
      const bounds = nodeBounds[node];
      const center = roomPoints[node];
      const candidates = [];
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
          const point = { level: 0, x, z };
          if (tileWalkable(point)) candidates.push(point);
        }
      }
      candidates.sort((left, right) => manhattan(left, center) - manhattan(right, center) || left.x - right.x || left.z - right.z);
      const anchor = candidates[0] ?? null;
      assert(anchor, `${node}: original map has an allocated, floored and collision-walkable room/corridor tile`);
      return anchor;
    };
    const nodeAnchors = Object.fromEntries(nodes.map(node => [node, findNodeAnchor(node)]));
    const corridorCases = exteriorNodes.map(node => ({
      node,
      lockBit: corridorBitByNode[node],
      point: nodeAnchors[node]
    }));
    const corridorForPoint = point => {
      if (point.x <= 3528) return 1;
      if (point.x >= 3575) return 7;
      if (point.z <= 9671) return 15;
      if (point.z >= 9718) return 0;
      return -1;
    };
    for (const corridor of corridorCases) {
      assert.equal(corridorForPoint(corridor.point), corridor.lockBit, `${corridor.node}: mapped corridor anchor selects its measured exterior door`);
    }
    const northCorridor = corridorCases.find(corridor => corridor.node === 'north_outside');
    assert(northCorridor, 'the measured north exterior corridor is available for seam coverage');
    const northIncidentCorner = cornerBits.findIndex(bits => bits.includes(northCorridor.lockBit));
    const northNonincidentCorner = cornerBits.findIndex(bits => !bits.includes(northCorridor.lockBit));
    assert.notEqual(northIncidentCorner, -1);
    assert.notEqual(northNonincidentCorner, -1);
    assert.equal(assertSeamBijection({
      label: 'north corridor open',
      player: makePlayer('north-corridor-seams', northCorridor.point.level, northCorridor.point.x, northCorridor.point.z),
      occupiedLock: northCorridor.lockBit,
      point: northCorridor.point,
      expectedCount: 512
    }), 512, 'the north corridor filter leaves exactly 512 global layout seams');
    assert.equal(assertSeamBijection({
      label: 'north R2 incident corner exclusion',
      player: makePlayer('north-r2-incident-seams', northCorridor.point.level, northCorridor.point.x, northCorridor.point.z),
      excludedCorner: northIncidentCorner,
      excludedEntrance: 1,
      occupiedLock: northCorridor.lockBit,
      point: northCorridor.point,
      expectedCount: 336
    }), 336, 'excluding an incident corner and one entrance leaves 336 safe seams');
    assert.equal(assertSeamBijection({
      label: 'north R2 nonincident corner exclusion',
      player: makePlayer('north-r2-nonincident-seams', northCorridor.point.level, northCorridor.point.x, northCorridor.point.z),
      excludedCorner: northNonincidentCorner,
      excludedEntrance: 1,
      occupiedLock: northCorridor.lockBit,
      point: northCorridor.point,
      expectedCount: 240
    }), 240, 'excluding a nonincident corner and one entrance leaves 240 safe seams');

    const redrawPlayer = makePlayer('corridor-redraw');
    for (const corridor of corridorCases) {
      redrawPlayer.level = corridor.point.level;
      redrawPlayer.x = corridor.point.x;
      redrawPlayer.z = corridor.point.z;
      for (let corner = 0; corner < 4; corner++) {
        const allowedOuterMasks = layoutMasksByCorner[corner].filter(mask => (mask & (1 << corridor.lockBit)) === 0);
        assert(allowedOuterMasks.length > 0, `${corridor.node}, corner ${corner}: at least one rank keeps the occupied corridor open`);
        for (let entrance = 0; entrance < 4; entrance++) {
          for (let selection = 0; selection < allowedOuterMasks.length; selection++) {
            setPlayerVar(redrawPlayer, 'barrows_state', stateWord({ identity: 5, phase: 1, corner, entrance }));
            setPlayerVar(redrawPlayer, 'barrows_generation', 811);
            const draw = withDraws([[selection, allowedOuterMasks.length]], () => procVoid(redrawPlayer, 'barrows_layout_draw', [corner, entrance]));
            assert.equal(draw.calls, 1, `${corridor.node}, corner ${corner}, entrance ${entrance}, selection ${selection}: one bounded rank draw`);
            const mask = allowedOuterMasks[selection] & ~(1 << centralBits[entrance]) & 0xffff;
            assert.equal(clientLockMask(redrawPlayer), mask, `${corridor.node}: draw selects the indexed corridor-safe packed rank`);
            assert.equal(mask & (1 << corridor.lockBit), 0, `${corridor.node}: redraw keeps the player's exterior door open`);
            assertValidLayout(mask, corner, entrance, `${corridor.node} redraw ${corner}/${entrance}/${selection}`);
          }
        }
      }
    }

    for (const [index, corridor] of corridorCases.entries()) {
      const oldCorner = index;
      const oldEntrance = index;
      const targetCorner = (index + 1) % 4;
      const layouts = eligibleLayouts({ excludedEntrance: oldEntrance, occupiedLock: corridor.lockBit });
      const target = layouts.find(layout => layout.corner === targetCorner);
      assert(target, `${corridor.node}: a new corner has a corridor-safe wrong-answer layout`);
      const seam = layouts.indexOf(target);
      const wrongPlayer = makePlayer(`wrong-corridor-${index}`, corridor.point.level, corridor.point.x, corridor.point.z);
      setPlayerVar(wrongPlayer, 'barrows', clientWord(expectedLockMask(oldEntrance, oldCorner, 0), oldCorner));
      setPlayerVar(wrongPlayer, 'barrows_state', stateWord({ identity: 5, phase: 1, corner: oldCorner, entrance: oldEntrance }));
      setPlayerVar(wrongPlayer, 'barrows_generation', 900 + index);
      const wrong = withDraws([[seam, layouts.length]], () => procInt(wrongPlayer, 'barrows_layout_wrong', [900 + index]));
      assert.equal(wrong.calls, 1, `${corridor.node}: wrong-answer redraw consumes one global safe-layout seam`);
      assert.equal(layouts.length, 384, `${corridor.node}: excluding the prior entrance leaves 384 corridor-safe seams`);
      assert.equal(wrong.value, 1, `${corridor.node}: current-generation wrong answer is accepted`);
      const wrongCorner = readRange(wrongPlayer.getVar(vars.barrows_state), ...stateRanges.corner);
      const wrongEntrance = readRange(wrongPlayer.getVar(vars.barrows_state), ...stateRanges.entrance);
      const wrongMask = clientLockMask(wrongPlayer);
      const wrongRank = layoutMasksByCorner[wrongCorner].indexOf(wrongMask | (1 << centralBits[wrongEntrance]));
      assert.deepEqual({ corner: wrongCorner, entrance: wrongEntrance, rank: wrongRank, mask: wrongMask }, target, `${corridor.node}: seam selects the indexed safe layout`);
      assert.notEqual(wrongEntrance, oldEntrance, `${corridor.node}: wrong answer excludes the previous central entrance`);
      assert.notEqual(wrongCorner, oldCorner, `${corridor.node}: wrong answer may select a different ladder corner`);
      assert.equal(wrongMask & (1 << corridor.lockBit), 0, `${corridor.node}: wrong-answer redraw leaves the paired exterior door open`);
      assertValidLayout(wrongMask, wrongCorner, wrongEntrance, `${corridor.node} wrong-answer redraw`);
    }
    redrawPlayer.level = 0;
    redrawPlayer.x = 3552;
    redrawPlayer.z = 9696;
    for (const [edge, placements] of edgeRows) {
      const [left, right] = edge.split('>');
      assert(nodeAnchors[left] && nodeAnchors[right], `${edge}: both measured endpoints have native walkable map tiles`);
      for (const placement of placements) {
        const normalSign = Math.sign(roomPoints[right][placement.axis] - roomPoints[left][placement.axis])
          || (placement.axis === 'z' ? (roomPoints[right].z >= roomPoints[left].z ? 1 : -1) : (roomPoints[right].x >= roomPoints[left].x ? 1 : -1));
        assert(normalSign !== 0, `${edge}: endpoint order defines a crossing axis`);
      }
    }

    const sourceFor = (placement, endpoint) => {
      const [left, right] = placement.edge.split('>');
      const other = endpoint === left ? right : left;
      assert(endpoint === left || endpoint === right, `${placement.edge}: requested endpoint belongs to the measured edge`);
      const sign = Math.sign(roomPoints[other][placement.axis] - roomPoints[endpoint][placement.axis]);
      assert.notEqual(sign, 0, `${placement.edge}: endpoints differ along the door normal`);
      const bounds = nodeBounds[endpoint];
      const candidates = [];
      for (const offset of [-1, 1]) {
        const point = {
          level: placement.level,
          x: placement.x + (placement.axis === 'x' ? offset : 0),
          z: placement.z + (placement.axis === 'z' ? offset : 0)
        };
        if (!withinBounds(point, bounds) || !tileWalkable(point)) continue;
        if (point[placement.laneAxis] !== placement[placement.laneAxis]) continue;
        if (Math.sign(point[placement.axis] - placement[placement.axis]) !== -sign) continue;
        candidates.push(point);
      }
      candidates.sort((a, b) => manhattan(a, roomPoints[endpoint]) - manhattan(b, roomPoints[endpoint]));
      return candidates[0] ?? null;
    };

    const doorA = makePlayer('door-a');
    const doorB = makePlayer('door-b');
    const nativeDoorPlayers = [doorA, doorB];
    for (const player of nativeDoorPlayers) {
      const slot = World.players.findIndex((entry, index) => index > 0 && !entry);
      assert.notEqual(slot, -1, 'a native player slot is available for the protected puzzle close hook');
      player.slot = slot;
      player.pid = slot;
      player.uid = (Number(player.username37 & 0x1fffffn) << 11) | slot;
      player.isActive = true;
      World.players[slot] = player;
      World.playerLoop.add(0x73000000n + BigInt(slot), player);
    }
    const doorGeneration = 700;
    const prepareDoorPlayer = (player, placement, locked, identity, solved) => {
      const mask = locked ? (0xffff | (1 << placement.lockBit)) & 0xffff : (0xffff & ~(1 << placement.lockBit));
      const centralIndex = centralBits.indexOf(placement.lockBit);
      setPlayerVar(player, 'barrows', clientWord(mask, 0, 0x5a5aa5a5));
      setPlayerVar(player, 'barrows_state', stateWord({
        identity, phase: 1, corner: 0, entrance: centralIndex >= 0 ? centralIndex : 0,
        solved: Boolean(solved)
      }));
      setPlayerVar(player, 'barrows_generation', doorGeneration);
      setPlayerVar(player, 'barrows_kills', 0x10203040);
      setPlayerVar(player, 'barrows_countdowns', 0x50607080);
      return mask;
    };
    const setPosition = (player, point) => {
      player.teleport(point.x, point.z, point.level);
      assert.deepEqual([player.level, player.x, player.z], [point.level, point.x, point.z], 'native fixture reposition reaches its allocated tile');
    };
    const setNativeLocTarget = (player, loc) => {
      player.target = loc;
      player.targetOp = ServerTriggerType.OPLOC1 - 7;
      const selected = player.getOpTrigger();
      assert(selected, `${LocType.get(loc.baseType).name}: native OPLOC1 dispatch resolves the unlocked child`);
      return selected;
    };
    const runSelected = (player, script, target, label) => {
      const state = ScriptRunner.init(script, player, target, []);
      const execution = player.runScript(state, true);
      assert.equal(execution, ScriptState.FINISHED, `${label}: selected native loc trigger finishes synchronously`);
      assert.equal(state.execution, ScriptState.FINISHED, `${label}: native loc trigger does not suspend or abort`);
      assert.equal(player.delayed, false, `${label}: native loc trigger leaves no delay`);
      assert.equal(player.activeScript, null, `${label}: native loc trigger leaves no suspended action`);
      assert.equal(player.protect, false, `${label}: native loc trigger releases protected access`);
    };
    const transitionVarps = new Map();
    const originalWorldMethods = new Map();
    const worldMutations = [];
    const worldMethods = ['changeLoc', 'addLoc', 'removeLoc', 'revertLoc'];
    for (const name of worldMethods) {
      const original = World[name];
      assert.equal(typeof original, 'function', `World.${name} is available for collision-mutation trapping`);
      originalWorldMethods.set(name, original);
      World[name] = function (...args) {
        worldMutations.push(name);
        return original.apply(this, args);
      };
    }
    const primitiveFlags = [...new Set(Object.values(CollisionFlag).filter(value =>
      Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0
    ))].sort((left, right) => left - right);
    const collisionSnapshot = () => {
      const words = new Uint32Array(64 * 64);
      let index = 0;
      for (let x = 55 * 64; x < 56 * 64; x++) {
        for (let z = 151 * 64; z < 152 * 64; z++) {
          let word = 0;
          for (const flag of primitiveFlags) {
            if (route.isFlagged(x, z, 0, flag)) word = u32(word | flag);
          }
          words[index++] = word;
        }
      }
      return words;
    };
    const doorHome = { level: doorA.level, x: doorA.x, z: doorA.z };
    setPosition(doorA, doorHome);
    setPosition(doorB, doorHome);
    const collisionBeforeDoors = collisionSnapshot();
    const npcCountBeforeDoors = World.getTotalNpcs();
    const npcsBeforeDoors = Array.from(World.npcs);
    const ordinaryDoorTypes = new Set(['barrows_bloodworm', 'barrows_rat', 'barrows_skeleton_unarmed'].map(name => NpcType.getId(name)));
    const retainedDoorActors = [];
    const coverage = new Map();
    let lockedPathNegativeChecked = false;
    let openPathPositiveChecked = false;
    let doorRandomCalls = 0;
    let doorTransferCount = 0;
    let eligibleDoorTransferCount = 0;
    let puzzleRandomCalls = 0;
    let placementRandomCalls = 0;
    const originalRankHandler = ScriptRunner.HANDLERS[ScriptOpcode.RANDOM];
    ScriptRunner.HANDLERS[ScriptOpcode.RANDOM] = state => {
      if (state.script.name === '[proc,barrows_door_tile]') placementRandomCalls++;
      originalRankHandler(state);
    };
    const originalRandom = JavaRandom.nextDouble;
    JavaRandom.nextDouble = function () {
      doorRandomCalls++;
      // S08's monster class and S09's presentation draws never redraw topology.
      return 0.5;
    };
    try {
      for (const placement of doorRows) {
        const [left, right] = placement.edge.split('>');
        const testedSources = [];
        for (const endpoint of [left, right]) {
          const source = sourceFor(placement, endpoint);
          if (source) testedSources.push({ endpoint, source });
        }
        assert(testedSources.length > 0, `${placement.name} at ${placement.x},${placement.z}: at least one measured walkable approach exists on its lane`);
        const edgeCoverage = coverage.get(placement.edge) ?? { endpoints: new Set(), lanes: new Set(), placements: new Set() };
        edgeCoverage.placements.add(`${placement.name}@${placement.x},${placement.z}`);
        for (const { endpoint, source } of testedSources) {
          const other = endpoint === left ? right : left;
          edgeCoverage.endpoints.add(endpoint);
          edgeCoverage.lanes.add(placement[placement.laneAxis]);
          assert(tileWalkable(source), `${placement.name}: measured source approach is an original-map walkable tile`);

          const lockVarbit = VarBitType.getId(`barrows_door_${placement.letter}`);
          const lockedMask = prepareDoorPlayer(doorA, placement, true, 1, centralBits.includes(placement.lockBit));
          prepareDoorPlayer(doorB, placement, false, 2, true);
          assert.equal(doorA.getVarBit(lockVarbit), 1, `${placement.name}: A's native parent lock varbit is locked`);
          assert.equal(doorB.getVarBit(lockVarbit), 0, `${placement.name}: B's same-generation lock varbit is independently open`);
          const bLockedBefore = snapshotPlayer(doorB);
          setPosition(doorA, source);
          if (!lockedPathNegativeChecked && placement.edge === 'n>center') {
            assert(!nativeRoute(source, nodeAnchors[other]), 'the original locked central door blocks native pathfinding from one side to the other');
            lockedPathNegativeChecked = true;
          }
          doorA.target = placement.loc;
          doorA.targetOp = ServerTriggerType.OPLOC1 - 7;
          assert.equal(doorA.getOpTrigger(), null, `${placement.name}: the locked child has no OPLOC1 trigger`);
          const aBeforeRefusal = snapshotPlayer(doorA);
          procVoid(doorA, 'barrows_door_use', [placement.id, CoordGrid.packCoord(placement.level, placement.x, placement.z)], placement.loc);
          assert.deepEqual([doorA.level, doorA.x, doorA.z], [source.level, source.x, source.z], `${placement.name}: direct locked helper refusal does not move A`);
          assert.deepEqual(snapshotPlayer(doorA), aBeforeRefusal, `${placement.name}: direct locked helper refusal changes no A state`);
          assert.deepEqual(snapshotPlayer(doorB), bLockedBefore, `${placement.name}: a locked click cannot alter B's same-generation state`);
          assert.equal(clientLockMask(doorA), lockedMask, `${placement.name}: locked refusal preserves A's lock varbits`);

          const openMask = prepareDoorPlayer(doorA, placement, false, 1, centralBits.includes(placement.lockBit));
          prepareDoorPlayer(doorB, placement, true, 2, true);
          assert.equal(doorA.getVarBit(lockVarbit), 0, `${placement.name}: state 0 selects the unlocked parent child`);
          assert.equal(doorB.getVarBit(lockVarbit), 1, `${placement.name}: B retains the opposite personal lock`);
          const bOpenBefore = snapshotPlayer(doorB);
          setPosition(doorA, source);
          const selected = setNativeLocTarget(doorA, placement.loc);
          assert.equal(selected.name, `[oploc1,barrows_door_unlocked_${placement.side}]`, `${placement.name}: native getOpTrigger selects only its side's unlocked child`);
          if (centralBits.includes(placement.lockBit)) {
            prepareDoorPlayer(doorA, placement, false, 1, false);
            setPosition(doorA, source);
            const unsolvedTrigger = setNativeLocTarget(doorA, placement.loc);
            const unsolvedBefore = snapshotPlayer(doorA);
            const randomBeforePuzzle = doorRandomCalls;
            const unsolvedState = ScriptRunner.init(unsolvedTrigger, doorA, placement.loc, []);
            doorA.executeScript(unsolvedState, true);
            assert.equal(unsolvedState.execution, ScriptState.PAUSEBUTTON, `${placement.name}: an unsolved central edge binds the real puzzle buttons`);
            assert.equal(doorA.activeScript, unsolvedState, `${placement.name}: the native continuation is retained`);
            assert.equal(doorRandomCalls - randomBeforePuzzle, 2, `${placement.name}: only family and permutation draw before an answer`);
            puzzleRandomCalls += 2;
            assert.deepEqual([doorA.level, doorA.x, doorA.z], [source.level, source.x, source.z], `${placement.name}: an unanswered central puzzle does not transfer`);
            const puzzlePresentation = {
              ...unsolvedBefore,
              client: setRange(unsolvedBefore.client, 2, ...clientRanges.puzzle),
              state: u32(setRange(setRange(unsolvedBefore.state, 2, ...stateRanges.family), 3, ...stateRanges.permutation) | (1 << challengeBit))
            };
            assert.deepEqual(snapshotPlayer(doorA), puzzlePresentation, `${placement.name}: opening changes only the puzzle presentation fields`);
            doorA.closeModal();
            assert.equal(doorA.activeScript, null, `${placement.name}: closing cancels the protected continuation`);
            assert.deepEqual(snapshotPlayer(doorA), {
              ...puzzlePresentation, state: u32(puzzlePresentation.state & ~(1 << challengeBit))
            }, `${placement.name}: cancellation preserves topology, credit, generation, countdown and selected models`);
            prepareDoorPlayer(doorA, placement, false, 1, true);
            setPosition(doorA, source);
          }
          const openTrigger = setNativeLocTarget(doorA, placement.loc);
          assert.equal(openMask & (1 << placement.lockBit), 0, `${placement.name}: the product helper receives this player's unlocked lock bit`);
          const aBeforeTransfer = snapshotPlayer(doorA);
          const nativeNpcsBefore = Array.from(World.npcs).filter(npc => npc.isActive);
          const randomBeforeTransfer = doorRandomCalls;
          const placementBeforeTransfer = placementRandomCalls;
          runSelected(doorA, openTrigger, placement.loc, `${placement.name} ${placement.edge}`);
          doorTransferCount++;
          const landed = { level: doorA.level, x: doorA.x, z: doorA.z };
          const destinationOccupants = nativeNpcsBefore.filter(npc => npc.level === landed.level && withinBounds(npc, nodeBounds[other]));
          const eligibleDraw = destinationOccupants.length < 11;
          if (eligibleDraw) eligibleDoorTransferCount++;
          const placementDraws = placementRandomCalls - placementBeforeTransfer;
          const spawned = Array.from(World.npcs).filter(npc => npc.isActive && !nativeNpcsBefore.includes(npc));
          assert.equal(placementDraws, spawned.length, `${placement.name}: one placement rank per actual encounter, no retry`);
          assert.equal(doorRandomCalls - randomBeforeTransfer, Number(eligibleDraw) + placementDraws,
            `${placement.name}: only a below-cap class draw and the independently counted placement rank`);
          assert.equal(landed.level, placement.level, `${placement.name}: transfer remains on the measured tunnel level`);
          assert.equal(landed[placement.laneAxis], placement[placement.laneAxis], `${placement.name}: transfer preserves the clicked lane`);
          assert(manhattan(landed, source) > 0, `${placement.name}: allowed transfer leaves its source tile`);
          const towardOther = Math.sign(roomPoints[other][placement.axis] - roomPoints[endpoint][placement.axis]);
          assert.equal(Math.sign(landed[placement.axis] - source[placement.axis]), towardOther, `${placement.name}: transfer crosses toward the opposite measured room/corridor`);
          assert(tileWalkable(landed), `${placement.name}: transfer lands on a floored, unblocked, allocated original-map tile`);
          if (!openPathPositiveChecked && placement.edge === 'n>center') {
            assert(nativeRoute(landed, nodeAnchors[other]), 'after the unlocked central transfer, the original native pathfinder can walk into the opposite room');
            openPathPositiveChecked = true;
          }
          assert.deepEqual(snapshotPlayer(doorA), aBeforeTransfer, `${placement.name}: door use changes no stored topology or generation`);
          assert.deepEqual(snapshotPlayer(doorB), bOpenBefore, `${placement.name}: A's allowed transfer cannot alter B's same-generation layout`);
          assert.equal(doorA.getVarBit(lockVarbit), 0, `${placement.name}: A retains its own unlocked door visual`);
          // S08 owns encounter selection. Retain each real ordinary summon so
          // cleanup, original-lifetime expiry and collision restoration are checked.
          retainedDoorActors.push(...spawned.filter(npc => ordinaryDoorTypes.has(npc.type)).map(npc => ({ npc, lifetime: npc.lifecycleTick })));
          procVoid(doorA, 'barrows_remove_owned');
          assert.equal(doorB.getVarBit(lockVarbit), 1, `${placement.name}: B retains its own locked door visual`);
        }
        coverage.set(placement.edge, edgeCoverage);
      }
      for (const [edge, placements] of edgeRows) {
        const tested = coverage.get(edge);
        assert(tested, `${edge}: measured parent placements ran through native triggers`);
        const [left, right] = edge.split('>');
        assert.deepEqual([...tested.endpoints].sort(), [left, right].sort(), `${edge}: both directions are exercised from original-map approach tiles`);
        assert.equal(tested.placements.size, placements.length, `${edge}: every measured parent placement/lane was executed`);
        assert(tested.lanes.size > 0, `${edge}: at least one measured lane was exercised`);
      }
      assert(lockedPathNegativeChecked, 'one representative locked internal corridor has a native pathfinder negative');
      assert(openPathPositiveChecked, 'one representative unlocked internal transfer has a native walk-positive control');
      assert(eligibleDoorTransferCount > 0 && eligibleDoorTransferCount < doorTransferCount, 'original map rooms exercise both below-cap and full-room traversals');
      assert.equal(doorRandomCalls, eligibleDoorTransferCount + puzzleRandomCalls + placementRandomCalls,
        'only below-cap S08 classes, valid placement ranks and S09 presentation choices draw; refusals draw none');
      assert.deepEqual(worldMutations, [], 'personal door operations never call World loc add/change/remove/revert');
      assert.equal(World.getTotalNpcs(), npcCountBeforeDoors + retainedDoorActors.length,
        'door encounter cleanup retains exactly its ordinary summons and every pre-existing map NPC');
      assert.deepEqual(retainedDoorActors.map(({ npc }) => [npc.isActive, npc.isActive && npc.getVar(VarNpcType.getId('npc_barrows_released')), npc.lifecycleTick]),
        retainedDoorActors.map(({ lifetime }) => [true, 1, lifetime]), 'every ordinary door actor is public with its original lifetime');
      // Execute native turns for the retained actors, with the world clock
      // advancing normally. Unrelated static map occupants do not take turns in
      // this bounded fixture, so their original occupancy is still comparable.
      const removedAt = retainedDoorActors.map(({ npc }) => npc.isActive ? null : 0);
      const lastTurn = Math.max(0, ...retainedDoorActors.map(({ lifetime }) => lifetime));
      for (let turn = 1; turn <= lastTurn; turn++) {
        World.currentTick++;
        for (const [index, { npc }] of retainedDoorActors.entries()) {
          if (npc.isActive) npc.turn();
          if (!npc.isActive && removedAt[index] === null) removedAt[index] = turn;
        }
      }
      assert.deepEqual(removedAt, retainedDoorActors.map(({ lifetime }) => lifetime), 'each abandoned actor expires at its original native lifetime');
      assert.equal(World.getTotalNpcs(), npcCountBeforeDoors, 'native expiry restores the pre-existing NPC count');
      assert.deepEqual(new Set(World.npcs), new Set(npcsBeforeDoors), 'native expiry preserves the exact pre-existing NPC set');
      // Native transfers move PLAYER_OCC too. Return both fixtures to their
      // initial tile before comparing every collision bit, including occupancy.
      setPosition(doorA, doorHome);
      setPosition(doorB, doorHome);
      assert.deepEqual(collisionSnapshot(), collisionBeforeDoors, 'all original tunnel collision flags remain byte-for-byte equivalent across A/B door operations');
    } finally {
      JavaRandom.nextDouble = originalRandom;
      ScriptRunner.HANDLERS[ScriptOpcode.RANDOM] = originalRankHandler;
      for (const [name, original] of originalWorldMethods) World[name] = original;
      for (const player of nativeDoorPlayers) {
        player.closeModal();
        delete World.players[player.slot];
        player.unlink();
        player.isActive = false;
      }
    }

    console.log(`PASS packed S07 topology: cornerTagged=${cornerTaggedLayouts}, uniqueMasks=${actualMasks.size}, corridorClosedLayouts=${actualCorridorClosedLayouts}, corridorClosedByNode=${JSON.stringify(actualCorridorClosedCounts)}`);
    console.log('PASS packed S07 layout seams: unconstrained 1024, R2 exclusions 576, north corridor 512, incident R2 336 and nonincident R2 240');
    console.log('PASS packed S07 lifecycle: begin/reset/wrong/Search varbits, seeded corner changes, stale guards and relog save/load');
    console.log('PASS packed S07 doors: all 64 native parent placements, both directions, personal visuals and unchanged shared collision');
  });
}

function withDraws(draws, action) {
  const original = activeRuntime.JavaRandom.nextDouble;
  const values = draws.map(([choice, bound]) => {
    assert(Number.isInteger(choice) && choice >= 0 && choice < bound, `controlled draw ${choice} must fit random(${bound})`);
    return (choice + 0.25) / bound;
  });
  let index = 0;
  activeRuntime.JavaRandom.nextDouble = function () {
    assert(index < values.length, 'packed operation consumed more controlled random draws than specified');
    return values[index++];
  };
  try {
    const value = action();
    assert.equal(index, values.length, 'packed operation consumed every specified random draw exactly once');
    return { value, calls: index };
  } finally {
    activeRuntime.JavaRandom.nextDouble = original;
  }
}

function withNoRandom(action) {
  const original = activeRuntime.JavaRandom.nextDouble;
  let calls = 0;
  activeRuntime.JavaRandom.nextDouble = function () {
    calls++;
    return original.call(this);
  };
  try {
    const value = action();
    return { value, calls };
  } finally {
    activeRuntime.JavaRandom.nextDouble = original;
  }
}

function startSuspendedProc(player, name, args) {
  const runtime = activeRuntime;
  const script = runtime.ScriptProvider.getByName(`[proc,${name}]`);
  assert(script, `compiled Barrows procedure is missing: ${name}`);
  const state = runtime.ScriptRunner.init(script, player, null, args);
  player.executeScript(state, true);
  assert.equal(state.execution, runtime.ScriptState.SUSPENDED, `${name} suspends at its authored delay`);
  assert.equal(player.delayed, true, `${name} retains its real player delay`);
  assert.equal(player.activeScript, state, `${name} retains the delayed product continuation`);
  return state;
}

function runNativeTrigger(player, trigger, label) {
  const runtime = activeRuntime;
  const state = runtime.ScriptRunner.init(trigger, player);
  const execution = player.runScript(state, true);
  assert.equal(execution, runtime.ScriptState.FINISHED, `${label} server trigger finishes synchronously`);
  assert.equal(state.execution, runtime.ScriptState.FINISHED, `${label} server trigger does not suspend or abort`);
  assert.equal(player.delayed, false, `${label} leaves no delayed player action`);
  assert.equal(player.activeScript, null, `${label} leaves no suspended script`);
  assert.equal(player.protect, false, `${label} releases protected access`);
}

function restorePlayer(source) {
  const player = activePlayerLoading.load(source.username, new activePacket(source.save()), null);
  player.uid = source.uid;
  player.pid = source.pid;
  player.write = message => {
    if (!player.packets) player.packets = [];
    player.packets.push(message);
  };
  player.messageGame = message => {
    if (!player.messages) player.messages = [];
    player.messages.push(message);
  };
  player.wrappedMessageGame = player.messageGame;
  return player;
}

function edgeAt(placement) {
  const roomRows = [['nw', 'n', 'ne'], ['w', 'center', 'e'], ['sw', 's', 'se']];
  const points = {
    nw: { x: 0, z: 0 }, n: { x: 1, z: 0 }, ne: { x: 2, z: 0 },
    w: { x: 0, z: 1 }, center: { x: 1, z: 1 }, e: { x: 2, z: 1 },
    sw: { x: 0, z: 2 }, s: { x: 1, z: 2 }, se: { x: 2, z: 2 },
    north_outside: { x: 1, z: -1 }, south_outside: { x: 1, z: 3 },
    west_outside: { x: -1, z: 1 }, east_outside: { x: 3, z: 1 }
  };
  const columns = edgeAt.columns;
  const rows = edgeAt.rows;
  const column = columns.reduce((best, value, index) => Math.abs(placement.x - value) < Math.abs(placement.x - columns[best]) ? index : best, 0);
  const row = rows.reduce((best, value, index) => Math.abs(placement.z - value) < Math.abs(placement.z - rows[best]) ? index : best, 0);
  const dx = placement.x - columns[column];
  const dz = placement.z - rows[row];
  assert(Math.min(Math.abs(dx), Math.abs(dz)) <= 1 && Math.max(Math.abs(dx), Math.abs(dz)) > 1, `map line ${placement.line}: door lies between measured room centers`);
  const horizontal = Math.abs(dx) > Math.abs(dz);
  const nextColumn = column + (horizontal ? Math.sign(dx) : 0);
  const nextRow = row - (horizontal ? 0 : Math.sign(dz));
  const room = roomRows[row][column];
  let neighbor;
  if (nextColumn < 0) neighbor = 'west_outside';
  else if (nextColumn > 2) neighbor = 'east_outside';
  else if (nextRow < 0) neighbor = 'north_outside';
  else if (nextRow > 2) neighbor = 'south_outside';
  else neighbor = roomRows[nextRow][nextColumn];
  if (neighbor.endsWith('_outside')) return `${room}>${neighbor}`;
  return points[room].z * 3 + points[room].x < points[neighbor].z * 3 + points[neighbor].x
    ? `${room}>${neighbor}`
    : `${neighbor}>${room}`;
}

let activeRuntime = null;
let activePacket = null;
let activePlayerLoading = null;

await main();
