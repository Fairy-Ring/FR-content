# Ancient autocast compiled test

After the full content pack is built, run from the engine directory:

```sh
node --import tsx ../content/tests/ancients3/test_ancients3.mjs
```

The default `all` case covers packed staff fields and combat parameters, the retained four-tick melee choice and sound without autocast, all 16 Ancient picker buttons and their gates, login/cancel/weapon/book lifecycle, repeated single- and area-target NPC autocasts with exact per-cast XP from the independent U1/U2 oracles, one PvP autocast repeat, rune/level/target-death continuation exits, Standard-to-Ancient melee fallback, real Desert Treasure Azzanadra completion clearing a stale Standard selection, and Observatory quest-reward presentation. Focused selectors are `--case picker`, `--case lifecycle`, `--case dispatch`, `--case exits`, `--case pvp`, `--case quest`, `--case reward`, and `--case melee`.
Auto Retaliate is off in the fixture so NPC retaliation cannot hide a broken autocast continuation.

`HARNESS_ENGINE_DIR` and `HARNESS_PACK_DIR` may select an isolated engine checkout and its pack root. The pack root contains `server/script.dat`; the symbolic client models are read from the checked-out content tree's `pack/model.pack`.

The Desert Treasure S0 structural test also checks the relocated staff: exactly one definition, its original pack identity, all fifteen original fields in order, and only the enumerated staff category and server-field additions. The certificate and every other S0 row keep their original checks.
