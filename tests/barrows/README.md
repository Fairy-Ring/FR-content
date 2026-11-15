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

Placement uses the measured landing tile, the named 0-to-2 radius and line-of-walk mode. Every tile of the selected NPC's footprint must be unblocked and in the destination room, without overlapping another NPC footprint. The overlap guard preserves native NPC occupancy when the summon is removed. Only one square is drawn: rejecting it can suppress a spawn even when another free square exists. An unsuccessful placement does not undo traversal or repeat the draw. Living twins remain eligible, but their identity credits only once. Owner, generation, killer attribution and cleanup use the existing S03/S04 contract.

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
