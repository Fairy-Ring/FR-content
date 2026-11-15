# Barrows checks

Run the registered check from the sibling engine:

```sh
node ../content/tests/barrows/test_config.mjs --content-root ../content
```

The test reads config names, types and values. It does not use generated enum or parameter IDs. Original cache identities still come from tracked packs.

The four mapped corner ladders and the chest define the tunnel room centres. Each placed door's coordinates select its two adjacent rooms, or its room and outside direction. The test compares these measured edges with the lock enum and the parent's lock varbit and parameter. Both halves and all placements contribute to the comparison. No lock-to-edge expectation table supplies the result.

Each negative control must exit 1. Add `--mutant NAME` to the command:

- `wrong-brother-join`: change the Ahrim sarcophagus enum join.
- `reversed-lock-polarity`: reverse the lock-state enum.
- `wrong-door-lock`: assign parent `barrows_door_e_r` to lock F in both its `multivar` and lock parameter. Its map-derived edge must reject that assignment.
- `swapped-parent-polarity`: swap the two `multiloc` children on parent `barrows_door_e_r`.

Mutants change only text in memory. They do not modify content files.

## Durable core (S01)

Build the sibling engine packs, then run:

```sh
node --import tsx ../content/tests/barrows/test_core.mjs
```

This check executes the packed run procs through the production script runner. It covers masked state, phases, generation changes, owner-only actor removal, the non-suspending Search latch/reset, personal connected layouts and saved countdown fields. S12's native Search owns the complete reward transaction; S06 and S13 attach their effects to the shared saved-countdown primitives.

Reset accepts only a paid run. Idle, unlooted and invalid phases retain every field, actor and presentation state. The paid control still proves generation advancement before actor removal and field clearing.

## Entry and exit (S02)

```sh
node --import tsx ../content/tests/barrows/test_entry.mjs
```

This check executes the packed entry, leave, logout and resume procs and the actual shared login/logout triggers, both with and without a run. It checks all six joined destinations and inverse exits, pre-loot retention, paid reset, exact saved countdown retention, and HUD reconstruction after login. Shared offline fixtures resolve generated config ids by name.

## Owned encounters (S03)

```sh
node --import tsx ../content/tests/barrows/test_owned.mjs
```

This check executes all six packed Search handlers with native loc/NPC fixtures. It covers the original slain joins, selected/credited suppression, private immutable owner and captured generation, both shared attack gates, independent owners, cleanup and uncredited retry. The fixtures apply each packed sarcophagus's real shape, rotation and clipping; native NPC turns must begin ordinary combat. Placement uses an open ring around the owner's legal approach tile, never a line back into the clipped coffin. A sealed-ring control rejects the native origin-return sentinel. Other terrain remains a natural-live concern. Mutable combat targeting does not make a map monster an owned summon. Brother combat styles and special attacks remain outside this group.

The common finder counts active own/current-generation actors, including the one owner interaction between lethal damage and queued credit. All six crypt witnesses execute real lethal damage, native Search, death turns and owner credit. Foreign-owner and stale-generation zero-HP actors remain negative controls. Neither the sarcophagus nor the chest needs a living-only finder.

Each crypt summon says the exact CANDIDATE 2007-base line and immediately targets its searching owner, following the published Rashiliyia minion convention. All six packed handlers prove that a second player on the owner's tile is not targeted. The speech is an OSRS-documentation fallback, not verified 377 wording; the period Tip.It guide separately verifies the immediate-attack statement. S08 uses the same owned constructor for door encounters.

The shared actor constructor returns a native NPC UID, or null on refusal. Presentation callers bind it with `npc_finduid` before reading or changing the active NPC; they do not assume that a proc call exports its pointer state. Its owner/generation admission and the common attackability/timer guards are unchanged.

The two-owner controls use the same generation, so a different generation cannot hide a missing owner check. Constructor-handle checks resolve the native UID and assert its requested type, owner and captured generation.

## Poison and appearance

```sh
node --import tsx ../content/tests/barrows/test_poison.mjs
node --import tsx ../content/tests/barrows/test_hint.mjs
```

Unowned tunnel monsters retain the published default poison timer, including the rat's first 35-to-31 hitpoint step. Owned actors use the shared counted poison helper without interrupting their one-tick owner check. Native turns cover the whole poison countdown and removal within one tick of departure, before and after poison ends. Poison is the published combat rule; counting timer runs is engineering.

Each awakened brother sends the existing `hint_npc` command only to its owner. The packed checks read the real hint packets at spawn, death, removal, timer departure and logout, with a second-player negative control. Ordinary tunnel monsters get no brother hint. This CANDIDATE appearance follows the near-target video and official picture; it changes no client cache bytes. The command precedent is the Haunted Mine ghost's appearance in `hauntedmine_boss_ghost.rs2`.
Both players are registered in the world's player slots and native zone list, so the second-player control also detects an accidental area broadcast.

## Monster configuration (S04)

```sh
node --import tsx ../content/tests/barrows/test_monsters.mjs
```

The source contract includes all seven original ordinary-monster level joins, the selected class NPCs and the one named engineering policy. The packed check executes all 128 draw-label/class bridges and verifies exact 12/52/32/32 counts, selected NPCs and the unknown-label no-spawn default. Numeric class keys are an internal representation; the authorized draw labels and rules are unchanged.

## Death and credit (S04)

```sh
node --import tsx ../content/tests/barrows/test_credit.mjs
```

The packed death hooks preserve the ordinary NPC death/drop path and bind its secondary NPC pointer. Credit delivery uses a captured generation, type and level; only an inside, matching unlooted run can change the original flag/count/potential fields. Brother identities credit once, owned summons require their normal combat hero to be their owner, and ordinary map monsters keep normal hero attribution. The check includes both caps and stale queued deliveries after reset and a new begin.

Native lethal-damage cases use the ordinary damage proc and owner timer, including HP regeneration immediately before queued death. The death trigger, not a second zero-HP test, is the credit producer's authority. Ownership, captured generation and protected unlooted delivery remain required.

## Personal topology (S07)

```sh
node --import tsx ../content/tests/barrows/test_topology.mjs
```

The packed chooser has 64 masks per ladder corner and central entrance: 1,024 distinct layouts. An independent enumeration of all sixteen-bit masks proves that the packed table contains every allowed layout. Each has one central entrance, exactly one openable door in the ladder room and routes between all nine rooms. Paired exterior corridors may be closed; a redraw keeps the occupied corridor open.

The UNKNOWN engineering policy is uniform over the complete set that satisfies the current shape, prior-run exclusions and occupancy constraints. The single random seam maps one-to-one onto 1,024 unconstrained layouts, 512 layouts with the north corridor occupied, or 576 layouts with one prior corner and central door excluded. An occupied corridor gives each corner 16 or 48 eligible masks per central entrance, not equal corner weights.

First runs permit all four corners and central doors. Consecutive begin/latch/reset cycles exclude the preceding run's corner and central door, including after save/load and relog. Search preserves the layout and draws nothing. Begin, paid reset and a wrong puzzle answer are the draw events. Original door transforms remain personal; shared wall collision never changes.

Open-door operations transfer between measured room-side tiles in the clicked lane. Pre-loot central access requires the real puzzle's authorization. The topology fixtures retain their lock, movement and shared-collision assertions while allowing S08's encounter draw. Chest Open raises an unmet brother without payment; S12's later Search pays the authorized open chest.

## Hidden tunnel (S05)

```sh
node --import tsx ../content/tests/barrows/test_tunnel.mjs
```

All six selected identities use the existing Continue prompt. The packed tests cover each identity at all four measured ladder landings, native button resumption and parent-ladder dispatch, cancellation, captured generation/identity/phase/origin guards and clean shared logout/login. The other five crypts still summon their residents. Entry and exit preserve unfinished progress and the already chosen layout; the visible ladder returns to the selected crypt's original entry join. No default-zero door layout or new selection is exposed.

## Prayer and faces (S06)

```sh
node --import tsx ../content/tests/barrows/test_prayer.mjs
```

The native protected timer repeats every tick and stores its exact Prayer remainder in varp 660's low half. The tests cover B=0..6, zero clamping, opposite-half preservation, busy-player stalls, all 64 slain masks and one-based face ranks in both palettes, the original objects and six blank overlay slots, high/low-detail controls, sequence-derived fade cleanup, generation changes, Search and reset, real shared login/logout, and native player save/load without offline replay. The 17-tick 8+B drain and the normal-crypt / green-tunnel palette rule are CANDIDATE. Uniform slain selection, matching original slot and unscaled object zoom are UNKNOWN engineering policies named in `barrows.constant`.

Face clearing sends `if_setobject(component, null, 1)` for every slot. The packed test runs the native IF_SETOBJECT encoder, decodes packet 21 as the 377 client does and asserts object 65535 changes every slot's model type to none. A hide-only negative control demonstrates why IF_SETHIDE cannot clear these model components; repeated faces cannot accumulate.

When a due drain leaves Prayer at zero, the same callback deactivates every active native prayer. A positive control leaves prayers active while points remain. Every nonempty high-detail face selection consumes exactly one random draw; B=0 and low detail consume none.

## Door encounters (S08)

```sh
node --import tsx ../content/tests/barrows/test_doors.mjs
```

Each successful traversal attempts one encounter in its destination room. The CANDIDATE table has exactly 12 brother, 52 skeleton, 32 bloodworm and 32 crypt-rat outcomes. Shared living occupancy admits a spawn at 10 enemies and suppresses it at 11. Paid traversals choose an uncredited brother instead of the 128-way table. An empty brother pool gives no spawn for a brother outcome or a paid traversal; ordinary unlooted outcomes still spawn.

Placement enumerates every valid footprint origin within the named 0-to-2 radius and line of walk. Every footprint square must be unblocked and in the destination room. No square can overlap any NPC footprint. The overlap guard preserves native NPC collision when the summon is removed.

UNKNOWN engineering `barrows_door_tile_distribution` selects one uniform rank from the complete valid set. Placement gives up only when that set is empty. It never repeats traversal or class selection. Living twins remain eligible, but their identity credits only once. Owner, generation, killer attribution and cleanup use the existing S03/S04 contract.

The placement regression first fails on the old occupied single-pick policy, then passes with a free alternative. The full suite covers one free tile, no free tiles, every footprint rank, unchanged caps and the exact 128-way class counts. A 5,500-observation xorshift32 sample uses seed 227252 and an 18% relative tolerance around each origin's expected frequency. The occupied-footprint mutant fails the nonoverlap assertion.

## Puzzle (S09)

```sh
node --import tsx ../content/tests/barrows/test_puzzle.mjs
```

The original main interface renders three prompts and three real answer buttons from server-only model tables. The first three family joins are VERIFIED; the rising bars remain CANDIDATE, including the allocation of the byte-identical 6727/6729 distractors. Four uniform families and six semantic permutations use the original model ids. A correct button authorizes one door transfer. A wrong button changes the central entrance, may retain or change the ladder corner, and uses the uniform occupied-room-safe layout draw. It shakes and resets the camera without rock damage.

The packed fixture covers all 24 presentations and all 72 native button positions. It checks the measured graph, single visible ladder and sole open ladder-room door after begin, reset and every wrong answer; Search draws nothing. Native main-modal access freezes both halves of the shared saved countdown without replacing its normal timer. A face already displayed can keep pulsing in the client until callbacks resume and clear it at the saved fade remainder. The real incoming NPC melee path cancels the modal and its buttons before queued damage; it retains the layout, selectors, raw puzzle field and timer.

Cancellation clears only challenge activity. Correct answers and ordinary save/load retain solved authorization, family, permutation and the raw client field. Paid Search preserves the original layout and raw puzzle field; the central door remains free in both directions after payment.

## Chest and final brother (S10)

```sh
node --import tsx ../content/tests/barrows/test_chest.mjs
node --import tsx ../content/tests/barrows/test_chest.mjs --regression --baseline-pack "$BASELINE_PACK"
```

Set `BASELINE_PACK` to the saved pre-S10 pack for the second command. It must fail on the unchanged native chest-open bit, before any S10 procedure lookup. The normal command runs the complete encounter, gate and lifecycle cases.

The original closed chest's native Open requires an unlooted, positive-generation run, the solved puzzle and one of its two original south-side approach squares. It sets only the original chest-open bit. An uncredited tunnel identity is forced without the D4 draw or room cap, unless this owner already has that active brother in the same generation, in the crypts or tunnels. The shared finder includes the interval between lethal damage and queued credit. Foreign owners and stale generations do not suppress the encounter. Placement reuses the complete native door-tile validation; a failed placement leaves the chest closed for a natural retry. Repeated Open creates no duplicate.

The forced actor uses the shared owner/generation constructor and targets the owner. Its 1,000-tick lifetime and reused 0-to-2 placement policy are UNKNOWN engineering choices. The exact challenge, "You dare steal from us!", is a CANDIDATE later reconstruction, not verified 377 wording.

`barrows_chest_search_allowed(generation)` supplies the chest/location/authorization gate. It requires Open, not the final death or all six slain. Open-unlooted save/load and clean shared logout/login retain the visual and genuine credit without paying; owner-only cleanup remains the existing encounter contract. Search now consumes that authorization in S12. Close keeps the unchanged "Nothing interesting happens." refusal and never closes or pays the chest.

## Shared login compatibility

`test_core.mjs` executes the real protected login twice for identical native accounts with all Barrows fields unset. The first run uses the built pack unchanged. The second replaces only `barrows_resume` in memory with a return-only proc, then restores it. Every varp, outgoing packet, message, interface, tab and final coordinate must match. The registered run reads no frozen published values and imports no other unit's test runtime.

Each login observation pins both `Math.random` and the engine's `JavaRandom.nextDouble`, then restores both in its `finally`. An unrelated shared-login random message must compare equal. A new message in the Barrows hook must still fail.

Optionally compare the head's login with an independently built published pack in the same run:

```sh
BARROWS_PUBLISHED_LOGIN_PACK=../reference-engine/data/pack node --import tsx ../content/tests/barrows/test_core.mjs
```

## Reward economics (S11)

```sh
node --import tsx ../content/tests/barrows/test_reward.mjs
```

The compiled pure reward procedures implement the CANDIDATE D6 reconstruction, not authenticated 2006 quantities. The 24 server-side gear rows join only the fresh unsuffixed original pieces. A chest's pool includes four pieces per credited unique brother, chooses equal conditional ranks and removes only an exact selected piece. B=0 has no equipment branch. Empty gear pools fall through to ordinary rewards.

The quantity proof compares every B=0..6, C=0..1000 and R=1..C+2B with an independent inclusive-band/rational-floor oracle: 3,545,542 native cases plus P=0. Seven seeded Bernoulli samples (including the exact B=0 control) and all 24 conditional rank sizes each use 1,200,000 trials. Seeds and absolute tolerances are those in the accepted plan. All slain masks, every single-piece removal/rank remapping and forced wins through the complete pool are separate exact checks. Pure rolls preserve additive stack quantities; S12 owns consolidation and the protected grant. Search still refuses on the standalone S11 head.

## Atomic reward grant (S12)

```sh
node --import tsx ../content/tests/barrows/test_grant.mjs
```

The original shown open child's native Search snapshots the real slain mask and potential, rolls B+1 complete results, then latches phase 2 and advances the generation before granting. One protected, non-suspending invocation removes this owner's old actors, freezes every credit bit and preserves all original layout/puzzle bits. No final kill or all-six requirement is added.

UNKNOWN engineering `barrows_grant_order` names the policy: sum stackable ordinary results and grant coins, mind, chaos, death, blood and bolt racks first; then grant single-item rewards and distinct gear in original roll order. The inherited `inv_add` merges existing stacks and spills the remainder onto the owner's floor in the same order. It does not refuse, open a capacity modal or transfer to another inventory.

The native witness spies on the real grant while retaining its effects. It checks every grant's protected/paid/generation/actor state, exact consolidation and merging, two-slot and full-inventory overflow, repeated keys, distinct gear, all 64 masks, P=0, current and old paid credit, repeat Search and pure guard refusals. The S10 fixture retains the real Open/save/load/logout/login assertions and now proves the reachable Search/Close boundary instead of expecting an obsolete Search refusal.

## Collapse and ordinary death (S13)

```sh
node --import tsx ../content/tests/barrows/test_collapse.mjs
```

Successful Search arms the saved high half once and restores the inherited shake. The same one-tick NORMAL timer decrements both independent halves. Paid tunnel callbacks reload the configured collapse interval, draw the named chance and choose a uniform inclusive amount. Unpaid or crypt callbacks cannot consume collapse time. Open, failed Search and repeat Search cannot arm or restart it. Busy access and offline time consume no saved ticks.

The guarded hit queue rechecks generation, paid phase and tunnel location at delivery, then calls `damage_self`, the entire ordinary `damage_player` queue body. Compiled comparisons cover identical hitsplats, HP, sound and death at zero for every configured amount; no floor, protection, non-HP stat drain or energy loss is added. A real queued hit after departure has no effect.

The canonical CANDIDATE D9 hook reuses `barrows_leave` before the first ordinary death delay. Pre-loot death preserves the whole run and both countdowns; paid death performs the existing protected reset. Native lethal-death controls compare ordinary kept inventory, shared death-tile drops and lifetimes, restored stats/energy and Lumbridge respawn. Shared login resumes exact paid-inside counters and restores shake after its final camera reset; outside paid login resets without shake.

The 5..6 range is CANDIDATE early-2007 evidence, not exact 377 arithmetic. Interval, chance, uniform amount distribution and inherited shake parameters are UNKNOWN engineering names in `barrows.constant`.

The paid tunnel-to-crypt transition sends one camera reset through the existing presentation cleanup. Twenty subsequent crypt ticks send no camera reset or shake. The saved collapse remainder and queued-hit guards remain unchanged. This preliminary 3 packet-count case fails on the previous per-tick reset, which sent twenty additional resets.

The ordinary-death checks derive the default respawn anchor, level and search radii from `scripts/player/scripts/death.rs2`. They load that map square and check the native destination against that definition, rather than a second hard-coded Lumbridge rectangle.

## Loot then leave (S14)

```sh
node --import tsx ../content/tests/barrows/test_leave.mjs
```

This is an integration-proof slice, not a second reset implementation. Native Search grants treasure once; repeat Search before departure changes neither treasure nor the paid escape run. The original stair exit uses the existing paid reset: generation advancement and owned-actor removal precede field clearing and its one idle-layout redraw, which precedes the stair's surface telejump. Treasure, foreign actors and unowned map actors remain. The retained selectors exclude the completed corner and central entrance at the next begin.

One genuinely captured native NPC credit request is delivered after reset and again inside the next creditable run. Both deliveries leave the run unchanged; a same-generation real producer supplies the positive credit control. Pre-loot stair departure preserves generation, layout, credit and both saved countdowns while removing owned actors and closing the ephemeral challenge and presentation. Separate mutants make the named S14 generation-order, unpaid-no-reset and old-generation rejection cases fail.

## Merged-login live replay (group 4 preliminary 1)

The merged campaign login retains the published camera clears before `barrows_resume`. The headed S13 replay proves paid-inside clean relog, restored shake, a resumed native hit and an outside no-hit control. The replay also retains its unpaid control and ordinary paid-death witness.

The first unchanged cell exhausted its own escape food after its relog predicates passed. The approved replacement imports the existing common modules. All eight inherited S13 checks and all four observation helpers remain byte-identical. It adds only the established S14 own-food provision and native Walk/Open/Eat escape.

`merged-login.evidence.txt` identifies both retained receipts. The starting-head build, rs2check, all 98 registered checks, varp transmission and client-byte equality passed. This proof changes no product script.

## Crypt logout lifecycle (S15)

```sh
node --import tsx ../content/tests/barrows/test_lifecycle.mjs
```

This proof-only slice executes the real shared logout/login triggers around native player save/load. A crypt owner has earned one brother, a second living uncredited brother and an exact saved timer remainder. Logout removes the live owned actor without credit or payment, stops presentation, preserves every durable word and leaves a foreign owner's fields, actor and packets and an unowned map actor unchanged. Login restores the same crypt and remainder without Barrows RNG; offline time consumes no ticks. Recreating the uncredited actor grants no credit.

Separate mutants omit actor cleanup, erase earned credit and redraw topology on login. Each fails its named new assertion. `lifecycle.evidence.txt` identifies the retained native output, red logs and gates; this adds no product lifecycle policy.

## Tunnel logout lifecycle (S16)

The registered lifecycle suite also executes real selected-tunnel descent, shared logout/login around native save/load, and the real ladder/return control. It independently earns B=2 and count=3 through compiled credit procs, checks all sixteen original locks, the selected ladder's real child, exact corner landing and all five durable words, and proves that offline time and pre-loot ladder departure do not redraw or pay. Three tunnel-only login mutants independently erase the ladder, erase credit or draw a new layout; each fails a named S16 assertion without failing S15 first. The headed single-account case earns B=1 naturally and proves the same ladder, locks, count and no-reset return. `lifecycle.evidence.txt` retains the exact identities and gates.

## Open-chest logout lifecycle (S17)

The lifecycle suite executes native Open and shared logout/save/load/login for every partial B=0..5. Open retains the original Search visual, whole earned credit and exact saved remainder, without payment or Barrows RNG. Closed, stale-generation, wrong-square, unsolved and already-paid controls still reject Search. A genuinely authorized partial-B Search pays once without requiring the final kill. Separate mutants close the visual on login, pay during login or require B=6. Each fails its named new assertion. The headed case retains its initial scene-origin comparison failure and proves the corrected world-tile floor comparison, unchanged treasure through relog and the explicit partial-B Search control. `lifecycle.evidence.txt` identifies both receipts and the native gates.

## Paid-chest logout lifecycle (S18)

The registered lifecycle suite reaches paid state through native Open and Search after proc-earned B=2/count=3. It then executes the real shared logout, native save/load and shared login for every pair of valid Prayer and collapse remainders. All five saved words, the frozen credit mask, sixteen escape locks and four ladder selectors survive without a Barrows draw or new treasure. The native NORMAL callback consumes exactly one saved tick from each half, never offline time. Current-generation post-payment credit and repeat Search remain inert. Each login's final camera packet restores every named shake parameter.

Five paid-only shared-login mutants erase frozen credit, redraw the escape layout, rearm collapse, reset the restored camera or duplicate one coin. Each passes S15 to S17 first, then fails its named new S18 assertion. The headed natural case retains the paid escape run and all treasure through clean relog, receives a fresh resumed native hit, and repeats Search without payment. Exact offline remainder preservation is a compiled claim, not equality between online live observations. `lifecycle.evidence.txt` retains the native, mutant, gate and headed identities.

## Ordinary-death lifecycle (S19)

The collapse suite adds actual surface non-Barrows death and pre-loot deaths in both a crypt and the open-chest tunnel. It executes the unchanged ordinary damage/death queue through its delays, native player save/load, shared outside login and actual crypt/tunnel return. Every saved run field and both countdowns survive before loot. The existing S13 paid-death witness remains the only paid reset policy. All cases compare ordinary loss, keep-three, restored stats/energy, shared floor ownership, content-defined drop lifetime and content-defined respawn.

Separate mutants erase credit at post-death outside login, erase credit at return Dig, advance a non-Barrows death's generation or alter ordinary drop lifetime. Each fails the corresponding assertion. The headed case earns prior credit, receives natural lethal brother damage, retains the whole run through outside relog and real return Dig, and compares a second natural non-Barrows death. No product script, shared hook or stored inert trace changes. `lifecycle.evidence.txt` retains the native, mutant, gate and live identities.

## Pre-loot teleport lifecycle (S20)

`teleport-exits.evidence.txt` inventories the published standard and Ancient spells, accepted Teleother, charged jewellery, Ring of Life, enchanted lyre, Ectophial and random-event boundaries. Every successful exit uses the existing native mapzone departure. No tablet handler is invented. Ruling 2 records that the published random-event failure queue cannot reach its declared transport after clearing its own event field. Its repair belongs to the random-events track.

The lifecycle suite executes 136 crypt/tunnel pre-loot cases over every configured Prayer remainder through the real normal spell, Ancient transport tail, portable Ectophial operation and random-event shared transport boundary. It checks exact whole-run and remainder preservation, owned-only cleanup, stopped presentation and timer, no outside or offline effects, native save/load/shared outside login, and genuine return with resumed inside drain. Paid shared-boundary controls from both origins retain actual earned treasure through the one paid reset.

Separate mutants omit departure cleanup, erase earned credit, rearm Prayer at return or omit the paid reset. Each fails its named new S20 assertion. The headed normal-spell case reads ordinary rune costs and XP from current content, then proves departure, outside no-effects, clean outside relog and natural return. No shared file or stored inert-login trace changes. `lifecycle.evidence.txt` retains the native, mutant, gate and live identities.

## Two-player isolation (S21)

```sh
node --import tsx ../content/tests/barrows/test_isolation.mjs
```

Two registered native players begin with matching generations. Actual owned actor construction, reciprocal attack admission and NPC death producers keep their residents and credit separate. Mixed-owner and ordinary map occupants share only the room-cap calculation. Native personal Open, full-bag Search and paid stair departure change no unfinished peer word, item, actor or presentation packet. Shared logout/save/load/login preserves B's unfinished run without a Barrows draw. Original global loc handlers retain their effects under observation and record no mutation.

Actual Take refuses the private overflow throughout the engine's first 99 elapsed ticks. The ordinary engine reveals it at tick 100. B's real shared Take then receives exactly the public stack without Barrows credit. This is ordinary floor ownership, not a new Barrows restriction. Captured native old kill and timer-hit requests stay on A and reject after reset and another run. A fresh native hit remains the positive control.

Eight separate mutants fail named assertions: global resident suppression, foreign attack admission, foreign credit routing, foreign cleanup, owner-only room counting, stale kill credit, stale collapse damage and global chest mutation. The headed two-account case reaches the common crypt and chest room naturally, forces A's genuine reward onto a full-bag private floor, lets B take the ordinary public runes, and preserves B's unfinished run through A's paid exit and B's clean relog. `lifecycle.evidence.txt` records the exact heads, all 110 viewed frames, native gates and the post-run world-tile observation correction.

