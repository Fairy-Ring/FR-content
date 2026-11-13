# Spawn repair regression

Run from the sibling engine after `npm run build`:

```sh
node --import tsx ../content/tests/spawn-repair/test_spawn_repair.mjs
```

The test covers 23 audited records inherited from the Lost City imports
`69bbbd28bba6c4eb3a8a20efabe4675f697a3e8a` and
`30efd7b9c940af979d938c9b3f28d2c944266526`.
The baseline is content `9fc0adf5f067b49d7d56800fa4fbdd53be01656e`.
Lost City 289 content `457c8943b5c1c3ebe338a12a9b12418c6c96c325`
supplies the same-tile alternatives.

All repairs are **CANDIDATE**, not verified period history:

- Eleven Falador citizens use the inferred +200 guard IDs. These otherwise
  unspawned guard variants have the Falador names, options and wall descriptions.
  Upstream corrected the adjacent gardener/workman IDs by the same offset.
- Six records restore the 289 actor or object at the same tile: Pirate Jackie,
  Moldof, two usable Buckets and two stacks of two nature runes.
- Four NPC records are removed. Their intended tiles remain **UNKNOWN**.
  Other exact-type spawns remain in their home regions.
- The tea quantity becomes one, matching the map's other single-item rows.
- Piglet 2320 remains unchanged at its known-wrong tile. It has no other spawn,
  and its intended tile is **UNKNOWN**. No coordinate is invented.

The test checks all 23 tiles, the three genuine Nardah citizens, every ground
quantity, exact totals, surviving home-region copies and packed identities.
It also compares every source spawn with the runtime map archive. A hash freezes
all non-target spawn rows, including the audit's 1,721 questionable records.
Future authorized map changes must update that conservation baseline and totals.
