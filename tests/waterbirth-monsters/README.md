# Waterbirth ordinary monsters: phase (a)

Run from the sibling engine after a full content build:

```sh
NODE_MEMBERS=true NODE_XPRATE=1 node --import tsx ../content/tests/waterbirth-monsters/test_waterbirth_monsters.mjs
```

The regression loads the real engine and compiled pack. It checks all six original forms, native aggression at minimum and maximum player levels with the level guard disabled, exact native retaliation and attack dispatch, attack animations, periods, ranged/magic projectiles, maximum damage and protection prayers. It executes every primary loot slot at both quantity extremes, all seed/talisman/helm subtable slots, the underground gem variant, every exact death handler, native Slayer credit where eligible, the no-hero loot guard and native respawn cleanup.

`HARNESS_ENGINE_DIR` and `HARNESS_PACK_DIR` can select an explicit engine and compiled pack for the old-code negative control. The registered invocation uses only the checked-out tree and its built pack. It contains no generated numeric IDs or stored bytecode. Historical labels and unresolved phase boundaries are documented in the vault research subject `waterbirth-monsters`.
