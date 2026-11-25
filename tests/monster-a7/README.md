# A7 goblins and cave goblins

Run from the sibling engine after a full content build:

```sh
node --import tsx ../content/tests/monster-a7/test_monster_a7.mjs
```

The test loads the native configs and the compiled scripts and starts no server. For the fourteen A7 types (four level-3 cave goblins, six placed level-11 miners, the level-26 and level-24 guards and the two level-5 goblin soldiers) it checks the original id, the visible level, the exact packed skills in pack order (attack, defence, strength, hitpoints, ranged, magic) and the levels of a spawned instance. The census formula of `tests/npc-combat` must reproduce each family's cache level.

A7 sets hitpoints, attack, strength and defence only. Each type must have no explicit parameter, and its server-side fields (wander, range, respawn, regeneration, hunt, mode, blocking, patrol) must equal the engine's own defaults, so a sibling block copied into one of these types fails. The effective attack interval, style, bonuses, animations, sounds and XP multiplier must be each parameter's own default: animation and sound defaults stay under the operator's M2(b) answer, and attack timing is not changed.

The real compiled `[label,player_melee_attack]` runs once per type with a controlled RNG: an accurate stab rolled at maximum 40 from full health. The label caps the XP-bearing damage at the NPC's remaining hitpoints, so the Attack XP is 40 tenths per configured hitpoint. This is the offline form of the plan's HP-XP rule; the headed natural encounters and the received NPC health are recorded in the evidence directory, not here.

The historical fact ids are `monster-combat-data.a7-*` in the research subject `monster-combat-data`. All values except the miners' hitpoints are CANDIDATE. `tests/npc-combat/built-vectors.json` holds the A7 entries and their evidence, and `snapshots.json` holds their pre-edit records at content `c48aeee1ac3d5067b04b4bcc743fc9de7a88c2e5`.
