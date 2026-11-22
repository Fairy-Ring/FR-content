# Ancient autocast compiled test

After the full content pack is built, run from the engine directory:

```sh
node --import tsx ../content/tests/ancients3/test_ancients3.mjs
```

The default `all` case covers packed staff fields and combat parameters, all 16 Ancient picker buttons and their gates, login/cancel/weapon/book lifecycle, repeated single- and area-target autocasts through Attack, Standard-to-Ancient melee fallback, and Observatory quest-reward presentation. Focused selectors are `--case picker`, `--case lifecycle`, `--case dispatch`, and `--case reward`.

`HARNESS_ENGINE_DIR` and `HARNESS_PACK_DIR` may select an isolated engine checkout and its pack root. The pack root contains `server/script.dat`; the symbolic client models are read from the checked-out content tree's `pack/model.pack`.
