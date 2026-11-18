// Coordinates use cache format plane_regionX_regionZ_localX_localZ.
// VERIFIED cache: these are the original LOC placements and directional actions.
// VERIFIED period: Tip.It 2006-05-10 says the central-room ladder descends to darker recesses.
// CANDIDATE topological pair: central p0 Climb-down ↔ the unique Dagexp Climb-up.
// VERIFIED period/wiki history: dagexp_exit_ladder is the separate Lighthouse branch, outside the ordered DK route.
// The p1 support alias and surface ice remain placement-only; p1 reachability is probed, not assumed.
export const traversalLocs = {
  surfaceRock: { name: 'dagannoth_caveentrance_rock', coord: '0_39_58_23_26' },
  surfaceIce: { name: 'dagannoth_caveentrance_ice', coord: '0_39_58_46_28' },
  rockySteps: { name: 'dagannoth_rocky_steps', coord: '0_38_158_8_34' },
  supportLadderDown: { name: 'dagannoth_ladder_base_ext2', coord: '0_39_158_50_31' },
  supportLadderUp: { name: 'dagannoth_ladder_base', coord: '1_39_158_50_31' },
  deepEntrance: { name: 'dagexp_entrance_ladder', coord: '3_28_68_6_54' },
  deepExit: { name: 'dagexp_exit_ladder', coord: '3_30_68_55_56' },
  bossRoomDown: { name: 'dagexp_bossroomladder_down', coord: '0_29_68_55_15' },
  bossRoomUp: { name: 'dagexp_bossroomladder_up', coord: '0_45_69_19_33' },
  bossRoomUpUpper: { name: 'dagexp_bossroomladder_up', coord: '1_45_69_19_33' },
};

// VERIFIED cache action pairing. Odd/even aliases are not ordered by floor:
// `up` always names the packed Climb-up endpoint and `down` the Climb-down one.
export const deepLadderPairs = [
  { down: { name: 'dagexp_ladder1', coord: '3_28_68_16_53' }, up: { name: 'dagexp_ladder2', coord: '2_28_68_17_53' } },
  { down: { name: 'dagexp_ladder3', coord: '3_28_68_32_52' }, up: { name: 'dagexp_ladder4', coord: '2_28_68_31_52' } },
  { down: { name: 'dagexp_ladder5', coord: '3_28_68_42_37' }, up: { name: 'dagexp_ladder6', coord: '2_28_68_42_36' } },
  { down: { name: 'dagexp_ladder7', coord: '2_28_68_19_42' }, up: { name: 'dagexp_ladder8', coord: '1_28_68_18_42' } },
  { down: { name: 'dagexp_ladder10', coord: '2_28_68_7_35' }, up: { name: 'dagexp_ladder9', coord: '1_28_68_7_36' } },
  { down: { name: 'dagexp_ladder11', coord: '2_28_68_5_30' }, up: { name: 'dagexp_ladder12', coord: '1_28_68_6_30' } },
  { down: { name: 'dagexp_ladder14', coord: '2_28_68_9_17' }, up: { name: 'dagexp_ladder13', coord: '1_28_68_10_17' } },
  { down: { name: 'dagexp_ladder15', coord: '2_28_68_34_10' }, up: { name: 'dagexp_ladder16', coord: '1_28_68_35_10' } },
  { down: { name: 'dagexp_ladder18', coord: '2_29_68_7_20' }, up: { name: 'dagexp_ladder17', coord: '1_29_68_7_19' } },
  { down: { name: 'dagexp_ladder19', coord: '2_29_68_8_36' }, up: { name: 'dagexp_ladder20', coord: '1_29_68_8_37' } },
  { down: { name: 'dagexp_ladder21', coord: '1_29_68_34_55' }, up: { name: 'dagexp_ladder22', coord: '0_29_68_34_56' } },
  { down: { name: 'dagexp_ladder24', coord: '1_30_68_37_20' }, up: { name: 'dagexp_ladder23', coord: '0_30_68_37_19' } },
  { down: { name: 'dagexp_ladder26', coord: '3_28_68_32_28' }, up: { name: 'dagexp_ladder25', coord: '2_28_68_32_29' } },
  { down: { name: 'dagexp_ladder27', coord: '3_28_68_46_24' }, up: { name: 'dagexp_ladder28', coord: '2_28_68_46_23' } },
  { down: { name: 'dagexp_ladder29', coord: '2_28_68_58_34' }, up: { name: 'dagexp_ladder30', coord: '1_28_68_58_33' } },
  { down: { name: 'dagexp_ladder31', coord: '2_30_68_12_27' }, up: { name: 'dagexp_ladder32', coord: '1_30_68_12_26' } },
  { down: { name: 'dagexp_ladder33', coord: '3_30_68_41_40' }, up: { name: 'dagexp_ladder34', coord: '2_30_68_41_39' } },
];
const coordinates = location => {
  const [level, mapX, mapZ, localX, localZ] = location.coord.split('_').map(Number);
  return { x: mapX * 64 + localX, z: mapZ * 64 + localZ, level };
};

const endpoint = location => ({ name: location.name, ...coordinates(location) });

const traversal = (from, option, landing) => ({
  from: { ...endpoint(from), option },
  landing: coordinates(landing),
});

// CANDIDATE topology: central Climb-up returns beside the cache's island ice entrance.
export const iceEntryRows = [
  traversal(traversalLocs.surfaceIce, 'Enter', traversalLocs.supportLadderDown),
  traversal(traversalLocs.supportLadderDown, 'Climb-up', traversalLocs.surfaceIce),
];

export const rockyStepsRows = [
  traversal(traversalLocs.surfaceRock, 'Enter', traversalLocs.rockySteps),
  traversal(traversalLocs.rockySteps, 'Climb', traversalLocs.surfaceRock),
];

export const centralToDeepRows = [
  traversal(traversalLocs.supportLadderDown, 'Climb-down', traversalLocs.deepEntrance),
  traversal(traversalLocs.deepEntrance, 'Climb-up', traversalLocs.supportLadderDown),
];

export const deepLadderRows = deepLadderPairs.flatMap(({ down, up }) => [
  traversal(down, 'Climb-down', up),
  traversal(up, 'Climb-up', down),
]);

export const kingsRoomLadderRows = [
  traversal(traversalLocs.bossRoomDown, 'Climb-down', traversalLocs.bossRoomUp),
  traversal(traversalLocs.bossRoomUp, 'Climb-up', traversalLocs.bossRoomDown),
];
const interactionOffsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

const walkableTiles = (map, point) => interactionOffsets
  .map(([dx, dz]) => ({ x: point.x + dx, z: point.z + dz, level: point.level }))
  .filter(tile => map.isZoneAllocated(tile.level, tile.x, tile.z) && !map.isMapBlocked(tile.x, tile.z, tile.level));

const reachesOperationRange = (map, start, target) => {
  if (start.level !== target.level) return false;
  for (const from of walkableTiles(map, start)) {
    for (const to of walkableTiles(map, target)) {
      if (from.x === to.x && from.z === to.z) return true;
      const route = map.findPath(from.level, from.x, from.z, to.x, to.z);
      const last = route.at(-1);
      if (last !== undefined && ((last >>> 14) & 0x3fff) === to.x && (last & 0x3fff) === to.z) return true;
    }
  }
  return false;
};

const validTraversal = (World, types, row) => {
  const locId = types.LocType.getId(row.from.name);
  if (!(locId >= 0) || !World.getLoc(row.from.x, row.from.z, row.from.level, locId)) return false;
  return types.LocType.get(locId).op.some(option => String(option).toLowerCase() === row.from.option.toLowerCase());
};

const pointKey = point => `${point.level}:${point.x}:${point.z}`;

// Returns null when packed collision has no continuous central-entry-to-Kings route.
export function findKingsRoute({ World, types, map }) {
  const finalLadder = kingsRoomLadderRows[0];
  if (!validTraversal(World, types, finalLadder)) return null;
  const ladders = deepLadderRows.filter(row => validTraversal(World, types, row));
  const start = centralToDeepRows[0].landing;
  const startKey = pointKey(start);
  const queue = [start];
  const previous = new Map([[startKey, null]]);
  const traversedBy = new Map();

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    const currentKey = pointKey(current);
    if (reachesOperationRange(map, current, finalLadder.from)) {
      const route = [];
      let key = currentKey;
      while (key !== startKey) {
        route.push(traversedBy.get(key));
        key = previous.get(key);
      }
      route.reverse();
      route.push(finalLadder);
      return route;
    }

    for (const row of ladders) {
      if (!reachesOperationRange(map, current, row.from)) continue;
      const nextKey = pointKey(row.landing);
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, currentKey);
      traversedBy.set(nextKey, row);
      queue.push(row.landing);
    }
  }
  return null;
}
