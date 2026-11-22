# S01 Slayer combat

Run from the pinned sibling engine after a clean content build:

```sh
node --import tsx ../content/tests/monster-s01/test_monster_s01.mjs
```

The test loads real packed configs and scripts into the engine VM. It checks the worn lit lantern gate, a carried lantern and an unlit lantern. The dust devil has no outgoing damage cap. A rune scimitar case uses the unchanged combat formula before and after the drain. Attack-time drains, fixed damage, prayer and the four-tick delay are checked separately. A carried facemask allows the full drain and queued 14 damage. A worn facemask prevents the drain and uses ordinary damage instead. Cave slime uses the unchanged published positive-hit poison path and antipoison immunity. Native player attack labels check melee, ranged and magic damage XP. Successful-cast base Magic XP remains.

The test asserts its own expected outcomes for the named Kurask, Turoth, dust devil, and harpie bug swarm cases: cannon damage and XP, recoil damage without XP, dust-devil facemask protection, and the harpie lit-lantern damage gate. No unrelated-NPC damage-cap baseline or capture mode remains.

The companion `tests/npc-combat` manifest checks each whole vector, original client identity and pre-edit snapshot. Formula levels are 93, 46 and 23, matching the cache. No formula exception or animation/sound change is needed. Research facts distinguish period-supported requirements from candidate mechanics and inherited, historically unknown generic poison timing/chance/decay.
