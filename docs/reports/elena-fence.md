# Elena barrier interaction and display names

## Implemented scope

The Plague City Elena visible child has an `apnpc1` trigger with range 2, using the existing imprisoned dialogue. The existing `opnpc1` still performs the rescue only when the player can reach her inside the cell. The locked-door path and the new AP path share the same label. Key possession does not make talking across the bars grant rescue, consume the key, or change quest progress.

The 28 literal `nc_name(elena2)` calls now use `nc_name(elena2_vis)`. The root has no display name; the visible child is named Elena. Wording, rewards and quest progression are otherwise unchanged. No engine, map, or loc configuration changed. The Biohazard house retains its original OP binding; an AP binding cannot bypass its original range-blocking perimeter.

## Barrier findings

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

**VERIFIED current runtime geometry:** with Elena at the observed wandering tile (2592,3338), every exterior tile in x=2588..2596, z=3332..3342 has neither line of sight nor approach visibility through the closed perimeter. The scan excludes only the interior rectangle x=2590..2594, z=3334..3338. Thus approaching across the transparent garden boundary does not avoid the opaque house boundary. This is a packed-engine observation, not proof of the complete historical server algorithm. At the cell, (2539,9671) can approach Elena at (2541,9672) across the railing without entering; (2539,9672) is instead directly behind the opaque cell door.

**DEVIATION requiring operator approval:** making the closed house door/walls range-transparent, replacing their placements, or bypassing their line-of-sight collision would deliberately depart from the original 377 data. None is implemented. The requested closed-house through-barrier interaction remains held for that decision, not reported as fixed.

## Historical dialogue and comparable content

Lost City 274/289 bankers and Fight Arena's caged NPCs use AP triggers with `p_aprange`, not weakened engine reach. The same mechanism is used for cell talk here. The engine's approach test also requires projectile line of sight, so AP cannot cross the opaque house boundary.

The [RuneHQ Plague City guide, archived 23 April 2004](https://web.archive.org/web/20040423204649/http://www.runehq.com/viewquest.php?id=00155) says to try the door, hear Elena's key hint, obtain the key, use it on the door, and then talk to Elena. A Zybez guide archived 20 February 2006 independently describes the same sequence. These verify the key-gated rescue sequence; they do not prove the exact historical NPC-click reach algorithm. The new direct across-bars talk is a source-backed CANDIDATE using that existing dialogue and Lost City AP convention. Period house guides establish conversation at her house, but do not establish conversation through its closed perimeter.

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
- `bash tests/elena-fence/runtime.sh <matching-engine>`: eight packed scenarios passed: key/no-key cell AP, inside rescue OP, both Edmond roots, all 153 literal name expressions, complete closed-house exterior visibility scan, inside-house Biohazard start/name. The runtime fixtures decode real packed maps and spawns, dispatch production interactions, and execute production RuneScript; only packet transport is captured. Elena's house position is a labeled fixture for the live-observed wandering tile. This is not a live-client acceptance claim.
- During fixture development, failures exposed an opaque-door tile instead of a railing tile, stale choice-button selection after the chat interface changed, and an unloaded Edmond underground map square. Fixtures were corrected; no production logic was weakened to pass them.
- No Rust crates are affected; Cargo tests, Clippy and rustfmt do not apply.

## LIVE CHECK — for the orchestrator

No live run was started by the implementer. Use the real placed NPCs and keep these steps distinct from runtime fixtures.

| STEP | WHY |
|---|---|
| Prepare an isolated mainland account with the harness `mainlandAccount` helper; relog, await scene-ready, take a screenshot before quest actions. Record all account-state interventions in the receipt. | Avoid tutorial, stale visibility, or missing-scene fixtures. |
| Seed only this account's Plague City state to the cell-search stage, with no key. Begin outside the plague-house cell; never teleport past its bars. Walk to (2539,9671) and click the real Elena across the railing. | Prove AP dialogue across a cache range-transparent barrier with no entry. |
| Continue the key-hint dialogue and both menu branches. Inspect stage and inventory. | Prove talk does not rescue her, supply a key, or award quest rewards. |
| Obtain the key through the quest barrel, return outside the same railing, and talk again. | Key possession alone must not grant rescue across the bars. |
| Use the real cell door with the key, enter, and talk to Elena. | Existing OP must still perform the rescue after actual entry. |
| Speak to Edmond and read the Elena reference; at the house, open its real door, enter, and start Biohazard. Capture the greeting and stage result. | Prove the rendered name is Elena and existing progression remains intact. This does not claim the held closed-house interaction is fixed. |
| Do not accept a closed-house outside interaction as passed. Bring the original-cache findings to the operator before changing loc collision or reach semantics. | The remaining request needs an explicit DEVIATION decision. |
