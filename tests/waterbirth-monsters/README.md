# Waterbirth non-King monsters

Run from the sibling engine after a full content build:

```sh
NODE_MEMBERS=true NODE_XPRATE=1 node --import tsx ../content/tests/waterbirth-monsters/test_waterbirth_monsters.mjs
NODE_MEMBERS=true NODE_XPRATE=1 node --import tsx ../content/tests/waterbirth-monsters/test_waterbirth_eggs.mjs
NODE_MEMBERS=true NODE_XPRATE=1 node --import tsx ../content/tests/waterbirth-monsters/test_waterbirth_crabs.mjs
NODE_MEMBERS=true NODE_XPRATE=1 node --import tsx ../content/tests/waterbirth-monsters/test_waterbirth_other_monsters.mjs
```

The regression loads the real engine and compiled pack. It checks all six original forms, native aggression at minimum and maximum player levels with the level guard disabled, exact native retaliation and attack dispatch, attack animations, periods, ranged/magic projectiles, maximum damage and protection prayers. It executes every primary loot slot at both quantity extremes, all seed/talisman/helm subtable slots, the underground gem variant, every exact death handler, native Slayer credit where eligible, the no-hero loot guard and native respawn cleanup.

The Egg regression drives native hunting, opening, Spawn combat, hero-credited Bones, uncredited death, loot-free expiry and repeated reset boundaries. The Crab regression covers natural wakes and the 37/36-HP native retreat boundary for both giant forms. The other-monster regression covers naturally placed hidden forms emerging on the autonomous timer without a nearby player, six submerge/emerge cycles, native combat, drops and respawn. Its adjacent hidden-melee positive control is an explicit offline NPC fixture: the original water placements have no native adjacent land reach. Original client fields are distinct from CANDIDATE server rules and UNKNOWN engineering values. Dagannoth Kings are outside these implementations.

`HARNESS_ENGINE_DIR` and `HARNESS_PACK_DIR` can select an explicit engine and compiled pack for the old-code negative control. The registered invocation uses only the checked-out tree and its built pack. It contains no generated numeric IDs or stored bytecode. Historical labels and unresolved phase boundaries are documented in the vault research subject `waterbirth-monsters`.
