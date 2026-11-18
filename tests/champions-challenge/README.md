# Champions' Challenge compiled runtime test

Run after building the content pack, from the sibling engine root:

```sh
node --import tsx ../content/tests/champions-challenge/test_champions_challenge.mjs
```

The fixture loads the real script pack and collision map without starting a world server. It exercises packed player, NPC, and location triggers; all eleven rules and rewards; banner save/load; ordinary death allocation; and the mapped level-0 trapdoor and ladder pair. It also checks shared equipment, pickup, prayer, teleport, magic, special-attack, and cannon hooks. The test requires the challenge content in the engine's `data/pack` directory. Set `HARNESS_ENGINE_DIR` or `HARNESS_PACK_DIR` only for a non-sibling engine or non-default pack location.
