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

This check executes the packed run procs through the production script runner. It covers masked state, phases, generation changes, owner-only actor removal, the non-suspending Search latch/reset, personal connected layouts and saved countdown fields. The Search latch has no player trigger or reward grant in this build group. S06 and S13 attach their effects to the shared saved-countdown primitives.

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

Each crypt summon says the exact CANDIDATE 2007-base line and immediately targets its searching owner, following the published Rashiliyia minion convention. All six packed handlers prove that a second player on the owner's tile is not targeted. The speech is an OSRS-documentation fallback, not verified 377 wording; the period Tip.It guide separately verifies the immediate-attack statement. Tunnel-door and chest presentation are not implemented here.

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

Open-door operations transfer between measured room-side tiles in the clicked lane. Central access remains closed until the later puzzle slice supplies authorization. No door encounter, puzzle or chest operation is reachable in this prefix.

## Hidden tunnel (S05)

```sh
node --import tsx ../content/tests/barrows/test_tunnel.mjs
```

All six selected identities use the existing Continue prompt. The packed tests cover each identity at all four measured ladder landings, native button resumption and parent-ladder dispatch, cancellation, captured generation/identity/phase/origin guards and clean shared logout/login. The other five crypts still summon their residents. Entry and exit preserve unfinished progress and the already chosen layout; the visible ladder returns to the selected crypt's original entry join. No default-zero door layout or new selection is exposed.

## Prayer and faces (S06)

```sh
node --import tsx ../content/tests/barrows/test_prayer.mjs
```

The native protected timer repeats every tick and stores its exact Prayer remainder in varp 660's low half. The tests cover B=0..6, zero clamping, opposite-half preservation, busy-player stalls, all 64 slain masks and one-based face ranks, the original normal objects and six blank overlay slots, high/low-detail controls, sequence-derived fade cleanup, generation changes, Search and reset, real shared login/logout, and native player save/load without offline replay. The 17-tick 8+B drain is CANDIDATE. Normal palette, uniform slain selection, matching original slot and unscaled object zoom are UNKNOWN engineering policies named in `barrows.constant`; no green alternative is drawn.

When a due drain leaves Prayer at zero, the same callback deactivates every active native prayer. A positive control leaves prayers active while points remain. Every nonempty high-detail face selection consumes exactly one random draw; B=0 and low detail consume none.
