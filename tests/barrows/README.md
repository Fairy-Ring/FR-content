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

This check executes the packed run procs through the production script runner. It covers masked state, phases, generation changes, owner-only actor removal, the non-suspending Search latch/reset, initial locked doors and saved countdown fields. The Search latch has no player trigger or reward grant in this build group. S07 replaces the all-locked layout initializer. S06 and S13 attach their effects to the shared saved-countdown primitives.

## Entry and exit (S02)

```sh
node --import tsx ../content/tests/barrows/test_entry.mjs
```

This check executes the packed entry, leave, logout and resume procs. It checks all six joined destinations and inverse exits, pre-loot retention, paid reset, exact saved countdown retention, and HUD reconstruction after login. Shared offline fixtures resolve generated config ids by name.

## Owned encounters (S03)

```sh
node --import tsx ../content/tests/barrows/test_owned.mjs
```

This check executes all six packed Search handlers with native loc/NPC fixtures. It covers the original slain joins, selected/credited suppression, private immutable owner and captured generation, both shared attack gates, independent owners, cleanup and uncredited retry. Mutable combat targeting does not make a map monster an owned summon. Offline placement-radius allocation is not a terrain proof; the natural live Search supplies that evidence. Brother combat styles and special attacks remain outside this group.

Each crypt summon says the exact CANDIDATE 2007-base line and immediately targets its searching owner, following the published Rashiliyia minion convention. All six packed handlers prove that a second player on the owner's tile is not targeted. The speech is an OSRS-documentation fallback, not verified 377 wording; the period Tip.It guide separately verifies the immediate-attack statement. Tunnel-door and chest presentation are not implemented here.

The shared actor constructor returns a native NPC UID, or null on refusal. Presentation callers bind it with `npc_finduid` before reading or changing the active NPC; they do not assume that a proc call exports its pointer state. Its owner/generation admission and the common attackability/timer guards are unchanged.

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
