# Elena barrier interaction and display names

## Implemented scope

The Plague City cell behavior matches the 827d258ec baseline: Elena is rescued only through the existing reachable `opnpc1` after opening the cell door. Across-bars AP talk is not implemented; period sources do not establish it (UNKNOWN), and it was reverted per operator decision 2026-11-06.

The 28 literal `nc_name(elena2)` calls now use `nc_name(elena2_vis)`. The root has no display name; the visible child is named Elena. Wording, rewards and quest progression are otherwise unchanged. No engine, map, or loc configuration changed. Biohazard house behavior retains its original cache-driven range block: closed door 2054 blocks range; open the door to talk (VERIFIED).

## Operator decisions — 2026-11-06

- **Biohazard house:** keep original-cache behavior. Door 2054 is VERIFIED as blocking range while closed; open the door to talk. No house interaction change.
- **Plague City cell:** across-bars talk is UNKNOWN in period sources and was reverted per operator decision. Reachable original OP rescue behavior remains.


**VERIFIED, original period cache data:** OpenRS2 cache [657, build 377, 2 May 2006](https://archive.openrs2.org/caches/runescape/657) was read directly, not inferred from authored RuneScript/config. Its archive `0/2.dat` SHA-256 is `e634030cfb9d7c3a83213d98b454e655313492bbfd62807ecfb8740de1ad9024`. The unpacked `l40_52` SHA-256 is `8ee17371415a6b6e72b389df181907de6a6ade92a09afd84e75ff34ba49ee70b`; the current full pack has identical bytes. The unpacked cell `l39_151` SHA-256 is `c630d2bce98ae0268e0949f5744c21f1236babaea6aae0b58d3890d5c7f35dbe`, also identical to the pack. Symbolic config names below are the content pack's labels for these cache IDs.

All coordinates below are level 0. Shape and rotation are numeric cache values.

| Placement | ID / config | Shape / rotation | Original blockwalk / blockrange |
|---|---|---|---|
| (2592,3339), edge to (2592,3338) | 2054 / `elenadoor2` (display name Door) | 0 / 3 | yes / yes |
| (2590,3339), (2591,3339), (2593,3339), (2594,3339) | 1602 / `timberwall` | 0 / 3 | yes / yes |
| (2589,3334..3338), west side | 1602 / `timberwall` | 0 / 2 | yes / yes |
| (2595,3334..3338), east side | 1602 / `timberwall` | 0 / 0 | yes / yes |
| (2590..2594,3333), south side | 1602 / `timberwall` | 0 / 1 | yes / yes |
| Corners (2589,3333), (2589,3339), (2595,3333), (2595,3339) | 1602 / `timberwall` | 3 / 1, 2, 0, 3 respectively | yes / yes |
| (2589..2595,3341), north garden boundary | 979 / `drystonewall` | 0 / 1 | yes / no |
| (2596,3341), garden boundary corner | 979 / `drystonewall` | 3 / 0 | yes / no |
| (2539,9670), (2539,9671), (2539,9673), cell bars | 997 / `railing` | 0 / 2 | yes / no |
| (2539,9672), cell door | 2526 / `elenagateshut` | 0 / 2 | yes / yes |

The house door's exact original 377 record is `13011e4f70656e0a010225040025050902446f6f720a0349742773206120646f6f722e0a00`. No opcode 17 or 18 disables either collision flag. Client-Java 377 `jagex2/config/LocType.java:341-352,436-443` independently documents the true defaults and these false-setting opcodes.

**VERIFIED, original 289 cache comparison:** [OpenRS2 cache 646, build 289, 18 January 2005](https://archive.openrs2.org/caches/runescape/646), `0/2.dat` SHA-256 `1880eae3a5c2a59e4ccff679a2440a87fffdc8042769825e24c7f5f66939184f`, has the same ID 2054 Door and the same yes/yes flags. IDs 1602, 979, 997 and 2526 have the same flags as the table. The door, perimeter walls, garden boundary, cell bars and cell door have the same placements, shapes and rotations in the two original caches.

**VERIFIED as Lost City authored content, not original-cache provenance:** Lost City `origin/289` at `457c8943b5c1c3ebe338a12a9b12418c6c96c325` also places `2054 0 3` at local `0 32 11` in `maps/m40_52.jm2:5528`. `scripts/areas/area_ardougne_east/configs/doors.loc:1-12` defines `elenadoor2` with the default blocking flags, Open operation, and `door_open_and_close` category. Its inherited `_unpack/225/all.loc:5352-5357,5458-5462,8900-8904` gives `drystonewall` and `railing` `blockrange=no`, but not `timberwall`. Original-cache decoding above corroborates these values independently.

**VERIFIED current runtime geometry, house:** with Elena at the observed wandering tile (2592,3338), the original closed perimeter blocks exterior approach. This is a packed-engine observation, not proof of the complete historical server algorithm. Door 2054 is VERIFIED as blockrange-blocking in original cache data.


## Historical dialogue and comparable content

Period sources do not establish talking through Plague City cell bars. That behavior is UNKNOWN and is not implemented, per operator decision 2026-11-06. The cache's cell bars have blockrange=no, but this alone does not establish the historical NPC interaction trigger.

## Every repaired name call

All entries change only `nc_name(elena2)` to `nc_name(elena2_vis)`. Line numbers refer to this change.

| File under scripts/ | Lines |
|---|---|
| areas/area_ardougne_east/scripts/elena.rs2 | 113 |
| areas/area_ardougne_west/scripts/man.rs2 | 15, 26 |
| areas/area_ardougne_west/scripts/mourner.rs2 | 88, 107, 115, 117 |
| areas/area_ardougne_west/scripts/woman.rs2 | 14, 27, 45, 49 |
| quests/quest_elena/scripts/alrena.rs2 | 50, 52 |
| quests/quest_elena/scripts/bravek.rs2 | 32, 69, 93 |
| quests/quest_elena/scripts/edmond.rs2 | 38, 42, 73, 79 |
| quests/quest_elena/scripts/jethick.rs2 | 16 |
| quests/quest_elena/scripts/rehnisons.rs2 | 17, 23, 27, 39, 40, 46, 50 |

## Checks exercised

- `npx tsx tools/rs2check.ts --content ../content`: 0 errors, 0 warnings, 13,993 scripts.
- `npm run build`: full isolated pack passed. No server started.
- `bash tests/elena-fence/runtime.sh <matching-engine>`: name-focused packed scenarios passed; no across-bars scenario remains. No engine started.
- No Rust crates are affected; Cargo tests, Clippy and rustfmt do not apply.
