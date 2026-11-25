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
- Piglet 2320 moves from the copied-coordinate tile 3019,3019 to 3019,3309
  inside the farm pen south of Falador. This is **CANDIDATE** Old School Piglet
  page r15196637 (25 April 2026) map data, not recovered 2006 coordinates.
  RuneScape wiki r240834 (9 October 2007) confirms the farm, not the tile.
  The production map loader and routefinder show the destination is standable
  inside the same enclosed pen as 2318 and 2319; no fence or terrain is changed.

The main test also retains the Mountain Daughter cavern removal of noted object
5685 at `m43_157`, level 0, local tile 32,30. It checks the repaired targets,
the three genuine Nardah citizens, ground quantities, surviving home-region
copies and packed identities. It compares every source spawn with the runtime
map archive. It does not freeze whole-corpus hashes or totals.

## Individual audit rows

`audited-spawns.txt` retains the 1,721 occurrences classified as `questionable`
in `U-SPAWNAUDIT-1113/suspect_npc_spawns.csv` and `suspect_obj_spawns.csv`.
The audit used content `588e7132f24ce5cf0ed1cae7d1a3378cd8540cd2`.
The list was checked against published content
`6fcfc51dab81e1b2b566f65cfda4422fea76d7d3`. The cavern note entry requires
its continued absence, rather than undoing the later repair. Piglet relocation
remains unchanged in the main test.

`test_audited_spawns.mjs` checks each listed map, section, level, tile, type
and quantity. It names missing or changed rows. Duplicate audit occurrences
require the same minimum multiplicity. Additions are allowed, including at
audited tiles. Rows outside this list are not frozen by this guard.

The main test always runs this guard. To test only source preservation, without
a pack or a server, run:

```sh
node ../content/tests/spawn-repair/test_audited_spawns.mjs
```

The full test still requires a pack built from the current sources. A source
mutation without repacking must use the source-only command to isolate this
guard from the separate source/pack equality check.

For a deliberate later repair, change that entry only and give the reason and
repair commit or source in its comment. Prefix a deliberately removed row with
`-`. The file header records this format. Do not regenerate unrelated entries.
