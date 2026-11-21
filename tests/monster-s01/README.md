# S01 Slayer combat

Run from the pinned sibling engine after a clean content build:

```sh
node --import tsx ../content/tests/monster-s01/test_monster_s01.mjs
```

The test loads real packed configs and scripts into the engine VM. It checks the worn lit lantern gate, a carried lantern and an unlit lantern. The dust devil has no outgoing damage cap. A rune scimitar case uses the unchanged combat formula before and after the drain. Attack-time drains, fixed damage, prayer and the four-tick delay are checked separately. A carried facemask allows the full drain and queued 14 damage. A worn facemask prevents the drain and uses ordinary damage instead. Cave slime uses the unchanged published positive-hit poison path and antipoison immunity. Native player attack labels check melee, ranged and magic damage XP. Successful-cast base Magic XP remains.

`published-max-dealt.json` comes from the published pack at content `b195a0ade83c9ef3a6c9b6c35a42c9e0520c7888` with `--baseline <output>`. Its thirty cap results cover ten NPC types in three styles, including the uncapped dust devil. `--open-paths` proves that published Kurask and Turoth allow cannon and recoil without their required weapon. The full suite retains those paths for dust devils and recoil for harpies. Cannon damage to a harpie now requires a worn lit lantern, with bare and equipped controls. These cases execute real attack procedures, not a mocked combat implementation.

The companion `tests/npc-combat` manifest checks each whole vector, original client identity and pre-edit snapshot. Formula levels are 93, 46 and 23, matching the cache. No formula exception or animation/sound change is needed. Research facts distinguish period-supported requirements from candidate mechanics and inherited, historically unknown generic poison timing/chance/decay.
