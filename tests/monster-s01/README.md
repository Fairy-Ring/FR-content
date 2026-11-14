# S01 Slayer combat

Run from the pinned sibling engine after a clean content build:

```sh
node --import tsx ../content/tests/monster-s01/test_monster_s01.mjs
```

The test loads real packed configs and scripts into the engine VM. It checks the facemask and worn lit lantern gates, a carried lantern and an unlit lantern, the dust devil's attack-time stat drains and fixed hit (including prayer), and cave slime poison through the unchanged published positive-hit path and its antipoison immunity. Native player attack labels prove the gates precede damage-derived XP in melee, ranged and magic; successful-cast base Magic XP remains.

`published-max-dealt.json` was captured from the pre-edit pack at content `fd897df92a72b94c536c5e6a27c0d2ae31771103` with `--baseline <output>`. Its other-NPC cap results are compared across the three styles; it is not a mocked combat implementation.

The companion `tests/npc-combat` manifest checks each whole vector, original client identity and pre-edit snapshot. Formula levels are 93, 46 and 23, matching the cache. No formula exception or animation/sound change is needed. Research facts distinguish period-supported requirements from candidate mechanics and inherited, historically unknown generic poison timing/chance/decay.
