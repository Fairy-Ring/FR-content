# Killerwatt encounter

Run from the sibling engine after a full content build:

```sh
node --import tsx ../content/tests/monster-s02/test_monster_s02.mjs
```

The test uses the native config loaders, static map, player save/load and packed RuneScript VM. It starts no server. RNG is controlled only for explicit hit and miss boundaries.

`published-paths.json` records the published pack before the S02 edit. It covers eight unrelated NPCs in melee, ranged and magic, plus the ordinary staircase for an account without the quest. The test compares admission, manual spell checks, messages, queues and the staircase result. Generated pack IDs are resolved by name.

The runtime cases cover both skill vectors, Slayer 36/37, refusal without transformation, activation through the owned OP/AP paths and the shared manual-spell admission, missing ammunition, missing runes, and ordinary-NPC first-attack scheduling. The unarmed AP phase only requests approach range, as the published handler does. It does not perform or delay an attack.

The encounter cases cover near/far styles, boots worn/carried/absent, the item's own base-Slayer 36/37 wear gate, maximum damage, protection prayers, attack interval, inactivity return without healing, active-target retention, and damage that bypasses target selection. Access cases cover the quest-controlled cache multiloc, ordinary upstairs climb, native quest completion beside the portal, strobe suppression, all boots-warning choices, return portal and native persistence of both bits.

Historical fact IDs are in the three research subjects: `monster-combat-data`, `slayer` and `draynor-village`. Exact skill numbers are packed-only. Live receipts belong to the evidence directory, not this test directory.
