# Giant Mole compiled fixture

From the sibling `engine/` directory, after `npm run build`:

```sh
node --import tsx ../content/tests/giant-mole/test_giant_mole.mjs
```

The fixture loads the built pack and actual packed map, then exercises production loc/NPC packet handlers, script queues, the darkness timer, normal death, and Wyson exchange without starting a server.

It checks the original mud-screen overlay and spotanims, cache-derived animation waits, light-overlay restoration, and exit cleanup. The headed cell reads `search-tiles.json` from its slot mirror; the fixture proves those stands are reachable and cover every walkable 3x3 NPC origin in the lair. These are fixture positions, not product burrow destinations.

Two useful negative controls:

1. Change the mole's half-health comparison from `<=` to `<` in `scripts/areas/area_falador/scripts/giant_mole.rs2`; the exact-half damage case must stop burrowing.
2. Remove `inv_del(inv, $part, 1);` from `wyson_mole_exchange` in `scripts/areas/area_falador/scripts/wyson_the_gardener.rs2`; item-use and dialogue exchange must fail the one-part/one-nest conservation assertions.
